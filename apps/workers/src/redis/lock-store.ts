/**
 * `RedisLockStore` — lock distribuído por conversa para o worker outbound
 * (F52-S10). Implementa o contrato `LockStore` de `lock.ts`, garantindo
 * **exclusão mútua entre processos** mesmo com múltiplas instâncias do worker.
 *
 * Padrão (industry standard, igual ao lock de scheduler de F2-S21):
 * - aquisição: `SET key token PX ttl NX` (atômico). Falhou → re-tenta com
 *   backoff jittered até obter ou estourar o `acquireTimeoutMs`.
 * - posse: o `token` aleatório identifica o dono. Um **watchdog** renova o TTL
 *   (`PEXPIRE` via Lua compare-and-renew) enquanto a seção crítica roda, para
 *   que envios lentos não percam o lock — sem nunca renovar lock de outro dono.
 * - liberação: `DEL` **condicional** por Lua (compare-and-delete). NUNCA `DEL`
 *   cego: se o TTL já expirou e outro processo readquiriu, não derrubamos o
 *   lock alheio.
 * - crash safety: se o processo dono morre, o watchdog para; o TTL expira e a
 *   conversa volta a ficar disponível (não trava para sempre).
 *
 * Ordenação FIFO estrita entre jobs da mesma conversa numa instância é
 * responsabilidade do `InMemoryFifoLockStore` local (ver `CompositeLockStore`);
 * este store cobre a fronteira entre processos.
 *
 * `verbatimModuleSyntax` ativo → `import type` para tipos.
 */
import type { LockStore, ReleaseFn } from '../lock';

/**
 * Subconjunto de `ioredis` usado pelo lock distribuído. Permite injetar um fake
 * determinístico nos testes e o cliente `ioredis` real em produção sem `any`.
 */
export interface RedisLockClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Logger mínimo (compatível com `@hm/logger`). */
export interface LockLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Libera o lock SOMENTE se o token bater (compare-and-delete). */
export const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Renova o TTL SOMENTE se o token bater (compare-and-renew). */
export const RENEW_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export interface RedisLockStoreOptions {
  /** Intervalo base entre tentativas de aquisição (jitter aplicado). Default 40ms. */
  readonly retryDelayMs?: number;
  /**
   * Tempo máximo de espera por aquisição antes de lançar (→ nack → DLX).
   * Default: `max(ttlMs * 2, 30s)` por aquisição. Limita a espera quando o
   * titular legítimo segura por muito tempo; o TTL cobre o caso de crash.
   */
  readonly acquireTimeoutMs?: number;
  /** Renova o TTL enquanto o lock é mantido. Default true. */
  readonly autoRenew?: boolean;
  /**
   * Intervalo de renovação do TTL. Default `ttlMs / 3` (margem confortável
   * antes da expiração). Só usado quando `autoRenew`.
   */
  readonly renewIntervalMs?: number;
  readonly logger?: LockLogger;
  /** Override de timers (testes determinísticos). Default: globais. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Não impede o processo de encerrar enquanto ocioso.
    (t as { unref?: () => void }).unref?.();
  });

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export class RedisLockStore implements LockStore {
  private readonly client: RedisLockClient;
  private readonly retryDelayMs: number;
  private readonly acquireTimeoutMs?: number;
  private readonly autoRenew: boolean;
  private readonly renewIntervalMs?: number;
  private readonly logger?: LockLogger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(client: RedisLockClient, options: RedisLockStoreOptions = {}) {
    this.client = client;
    this.retryDelayMs = options.retryDelayMs ?? 40;
    this.acquireTimeoutMs = options.acquireTimeoutMs;
    this.autoRenew = options.autoRenew ?? true;
    this.renewIntervalMs = options.renewIntervalMs;
    this.logger = options.logger;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async acquire(key: string, ttlMs: number): Promise<ReleaseFn> {
    const token = randomToken();
    const timeoutMs = this.acquireTimeoutMs ?? Math.max(ttlMs * 2, 30_000);
    const deadline = Date.now() + timeoutMs;

    // Loop de aquisição com backoff jittered até obter ou estourar o deadline.
    for (;;) {
      const ok = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      if (ok === 'OK') break;
      if (Date.now() >= deadline) {
        throw new Error(
          `RedisLockStore: timeout adquirindo lock "${key}" após ${timeoutMs}ms`,
        );
      }
      // Jitter (±50%) evita thundering herd entre waiters.
      const jitter = this.retryDelayMs * (0.5 + Math.random());
      await this.sleep(Math.min(jitter, Math.max(0, deadline - Date.now())));
    }

    const renewTimer = this.startRenewal(key, token, ttlMs);

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      if (renewTimer) clearInterval(renewTimer);
      try {
        await this.client.eval(UNLOCK_LUA, 1, key, token);
      } catch (err) {
        // Liberação best-effort: se o DEL condicional falhar, o TTL ainda
        // garante que a chave expira e a conversa não trava para sempre.
        this.logger?.warn('RedisLockStore: falha ao liberar lock (TTL cobre)', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
  }

  /** Watchdog: renova o TTL periodicamente enquanto o lock é mantido. */
  private startRenewal(
    key: string,
    token: string,
    ttlMs: number,
  ): ReturnType<typeof setInterval> | undefined {
    if (!this.autoRenew) return undefined;
    const intervalMs = Math.max(1, this.renewIntervalMs ?? Math.floor(ttlMs / 3));
    const timer = setInterval(() => {
      void this.client.eval(RENEW_LUA, 1, key, token, ttlMs).catch((err: unknown) => {
        this.logger?.warn('RedisLockStore: falha ao renovar TTL do lock', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    (timer as { unref?: () => void }).unref?.();
    return timer;
  }
}
