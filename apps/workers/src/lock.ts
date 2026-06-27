/**
 * Lock distribuído com FIFO por chave (LIVECHAT.md §3.4).
 *
 * O worker outbound precisa garantir **ordem entre mensagens enviadas em
 * sequência rápida na mesma conversa** (FX-007). Para isso serializamos a
 * seção crítica por `key` (`hm:lock:outbound:${conversationId}`).
 *
 * Arquitetura: `runWithDistributedLock` depende de um `LockStore` injetável.
 *
 * - Default = `InMemoryFifoLockStore`: uma fila de espera por chave dentro do
 *   processo. Garante **ordem FIFO** e exclusão mútua para todos os jobs
 *   processados por uma instância do worker (o caso comum: um consumer por fila
 *   com `prefetch`). É a fonte de verdade de ordenação enquanto roda uma única
 *   instância.
 * - Para múltiplas instâncias do worker, injeta-se um `LockStore` baseado em
 *   Redis (`SET NX PX` + token + unlock por Lua) — `RedisLockStore` em
 *   `redis/lock-store.ts` (F52-S10). Em produção o store outbound é um
 *   `CompositeLockStore(InMemoryFifoLockStore, RedisLockStore)`: o FIFO local
 *   ordena estritamente os jobs da MESMA conversa que caem na mesma instância
 *   (essencial com `prefetch > 1`), e o lock Redis garante **exclusão mútua
 *   entre processos**. O contrato `LockStore` recebe ambos sem tocar no fluxo
 *   crítico do worker.
 *
 * `verbatimModuleSyntax` ativo → `import type` para tipos.
 */

/** Função liberadora retornada pela aquisição de um lock. Idempotente. */
export type ReleaseFn = () => Promise<void>;

/**
 * Backend de lock. Implementações garantem que, para uma mesma `key`, apenas
 * um titular execute por vez. `ttlMs` é o tempo máximo de posse (proteção
 * contra titular travado); a implementação deve liberar/expirar após isso.
 */
export interface LockStore {
  /**
   * Adquire o lock de `key`. Resolve com a função de liberação quando o lock é
   * obtido. Implementações FIFO concedem na ordem de chegada.
   */
  acquire(key: string, ttlMs: number): Promise<ReleaseFn>;
}

interface Waiter {
  readonly resolve: () => void;
}

/** Estado de uma chave: se está possuída + fila de espera ordenada (FIFO). */
interface KeyState {
  held: boolean;
  readonly queue: Waiter[];
  /** Timer de expiração do titular atual (proteção contra deadlock). */
  expiry?: ReturnType<typeof setTimeout>;
}

/**
 * Lock FIFO em memória. Serializa por `key` dentro do processo. Correto e
 * suficiente para ordenação por conversa numa única instância do worker.
 */
export class InMemoryFifoLockStore implements LockStore {
  private readonly keys = new Map<string, KeyState>();

  async acquire(key: string, ttlMs: number): Promise<ReleaseFn> {
    const state = this.keys.get(key) ?? { held: false, queue: [] };
    if (!this.keys.has(key)) this.keys.set(key, state);

    if (state.held) {
      // Entra na fila e aguarda a vez (FIFO — ordem de push === ordem de espera).
      await new Promise<void>((resolve) => {
        state.queue.push({ resolve });
      });
    } else {
      state.held = true;
    }

    this.armExpiry(key, state, ttlMs);

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await Promise.resolve();
      this.handover(key, state);
    };
  }

  /** Arma (ou rearma) o timer de expiração do titular atual. */
  private armExpiry(key: string, state: KeyState, ttlMs: number): void {
    if (state.expiry) clearTimeout(state.expiry);
    state.expiry = setTimeout(() => {
      // Titular excedeu o TTL — força handover para não travar a conversa.
      this.handover(key, state);
    }, ttlMs);
    // Não impede o processo de encerrar enquanto ocioso.
    state.expiry.unref?.();
  }

  /** Passa a posse ao próximo da fila ou marca a chave como livre. */
  private handover(key: string, state: KeyState): void {
    if (state.expiry) {
      clearTimeout(state.expiry);
      state.expiry = undefined;
    }
    const next = state.queue.shift();
    if (next) {
      // Mantém `held = true`: a posse passa direto ao próximo titular.
      next.resolve();
    } else {
      state.held = false;
      if (state.queue.length === 0) this.keys.delete(key);
    }
  }
}

/**
 * Compõe vários `LockStore` em cascata: adquire na ordem informada e libera na
 * ordem inversa (LIFO). Usado em produção como
 * `CompositeLockStore(InMemoryFifoLockStore, RedisLockStore)`:
 *
 * - O store local (FIFO em memória) é adquirido **primeiro** → serializa e
 *   ordena estritamente os jobs da mesma conversa dentro desta instância.
 * - O store Redis é adquirido **depois** → garante exclusão mútua entre
 *   processos. Só o titular local de uma conversa disputa o lock distribuído,
 *   o que reduz a contenção no Redis ao mínimo necessário.
 *
 * Se uma aquisição falhar no meio da cascata, os locks já obtidos são liberados
 * antes de propagar o erro (sem vazamento de lock).
 */
export class CompositeLockStore implements LockStore {
  private readonly stores: readonly LockStore[];

  constructor(...stores: LockStore[]) {
    this.stores = stores;
  }

  async acquire(key: string, ttlMs: number): Promise<ReleaseFn> {
    const acquired: ReleaseFn[] = [];
    try {
      for (const store of this.stores) {
        acquired.push(await store.acquire(key, ttlMs));
      }
    } catch (err) {
      // Reverte o que já foi obtido (LIFO) antes de propagar.
      await this.releaseAll(acquired);
      throw err;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.releaseAll(acquired);
    };
  }

  /** Libera em ordem inversa; agrega falhas sem deixar locks pendentes. */
  private async releaseAll(releases: readonly ReleaseFn[]): Promise<void> {
    let firstError: unknown;
    for (let i = releases.length - 1; i >= 0; i -= 1) {
      try {
        const release = releases[i];
        if (release) await release();
      } catch (err) {
        firstError ??= err;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}

/** Store default do processo (singleton). */
const defaultStore: LockStore = new InMemoryFifoLockStore();

/**
 * Executa `fn` sob o lock de `key`, liberando ao final (mesmo em erro).
 *
 * @param key   Chave do lock (ex.: `hm:lock:outbound:${conversationId}`).
 * @param ttlMs Tempo máximo de posse antes da expiração forçada (ex.: 90_000).
 * @param fn    Seção crítica.
 * @param store Backend de lock (default: FIFO em memória).
 */
export async function runWithDistributedLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  store: LockStore = defaultStore,
): Promise<T> {
  const release = await store.acquire(key, ttlMs);
  try {
    return await fn();
  } finally {
    await release();
  }
}
