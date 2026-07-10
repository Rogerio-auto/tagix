/**
 * @hm/shared/mq/connection — conexão AMQP resiliente (F56-S12, INF-01).
 *
 * ## Por que isto existe
 * O `connectMq` original abria conexão+canal e não tratava NADA: sem
 * `on('error')`, sem `on('close')`, sem reconexão. Um blip do RabbitMQ virava
 * `uncaughtException` (o evento `error` sem listener derruba o processo — e a
 * frota inteira reinicia) ou deixava um consumer morto em silêncio (fila
 * acumulando sem alarme). Mensagem de cliente perdida sem diagnóstico.
 *
 * ## Desenho
 * `connectMq` devolve o MESMO shape de sempre (`{ connection, channel }`) —
 * nenhum consumer muda — mas ambos são fachadas (Proxy) sobre um
 * `MqConnectionManager` interno:
 *
 * - a PRIMEIRA conexão continua falhando rápido (boot sem broker → throw →
 *   supervisor reinicia; comportamento preservado);
 * - depois de conectado, `close`/`error` vindos do broker disparam reconexão
 *   com backoff exponencial + jitter, recriando conexão/canal e RE-EXECUTANDO
 *   as operações de setup registradas (assertExchange/assertQueue/bindQueue/
 *   bindExchange/prefetch/consume) na ordem original — topologia re-declarada
 *   e consumers re-registrados sem restart do processo;
 * - erro só de CANAL (ex.: 406) recria apenas o canal sobre a mesma conexão;
 * - `ack`/`nack` de mensagens entregues por um canal ANTERIOR são descartados
 *   com log (delivery tag é por canal; o broker reentrega a mensagem
 *   não-ackada — semântica at-least-once preservada) em vez de estourar
 *   `PRECONDITION_FAILED` e derrubar o canal novo;
 * - fechar pelo app (`connection.close()` / `handle.close()`) desliga a
 *   reconexão — shutdown limpo continua limpo.
 *
 * ## Estado para healthcheck (F56-S17)
 * Por handle: `handle.isConnected()` / `handle.state()`. Agregado do processo:
 * `getMqHealth()` / `isMqConnected()` — o /healthz dos workers consome isto.
 */
import { connect, type Channel } from 'amqplib';
import type { RetryLogger } from './retry';
import { incMqStat } from './stats';

type Conn = Awaited<ReturnType<typeof connect>>;

/** Shape histórico devolvido por `connectMq` — consumido por API e workers. */
export interface MqHandle {
  connection: Conn;
  channel: Channel;
}

/** Snapshot do estado de UMA conexão gerenciada (alimenta o /healthz). */
export interface MqConnectionState {
  readonly connected: boolean;
  readonly reconnecting: boolean;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastConnectedAt: string | null;
  readonly lastDisconnectedAt: string | null;
}

/** Agregado de todas as conexões vivas do processo. */
export interface MqHealth {
  readonly healthy: boolean;
  readonly connections: readonly MqConnectionState[];
}

/** Parâmetros do backoff exponencial de reconexão. */
export interface MqReconnectOptions {
  /** Delay base da 1ª tentativa (default 500ms). */
  readonly initialDelayMs?: number;
  /** Teto do delay (default 30s). */
  readonly maxDelayMs?: number;
  /** Fator de crescimento por falha consecutiva (default 2). */
  readonly multiplier?: number;
  /** Jitter aleatório (50–100% do delay) para evitar thundering herd (default true). */
  readonly jitter?: boolean;
}

export const DEFAULT_RECONNECT: Required<MqReconnectOptions> = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: true,
};

/** Opções (todas opcionais — chamada legada `connectMq()` permanece válida). */
export interface ConnectMqOptions {
  /** `false` desliga a reconexão (comportamento pré-F56-S12). */
  readonly reconnect?: MqReconnectOptions | false;
  /** Logger estruturado para eventos de queda/reconexão. */
  readonly logger?: RetryLogger;
}

/** Handle enriquecido (aditivo sobre `MqHandle` — retro-compatível). */
export interface ResilientMqHandle extends MqHandle {
  /** `true` quando conexão E canal estão abertos agora. */
  isConnected(): boolean;
  /** Snapshot detalhado (para /healthz e diagnóstico). */
  state(): MqConnectionState;
  /** Fecha canal+conexão e desliga a reconexão (equivale a `connection.close()`). */
  close(): Promise<void>;
}

/** Operação rejeitada porque a conexão está caída (reconexão em curso). */
export class MqNotConnectedError extends Error {
  override readonly name = 'MqNotConnectedError';
  constructor(op: string) {
    super(`AMQP indisponível (reconectando): operação '${op}' rejeitada`);
  }
}

// Métodos de SETUP: registrados e re-executados (na ordem) a cada reconexão.
const SETUP_METHODS: ReadonlySet<string> = new Set([
  'assertExchange',
  'assertQueue',
  'bindQueue',
  'bindExchange',
  'prefetch',
  'consume',
]);

// Métodos de ENTREGA: guardados por época de canal (delivery tag é por canal).
const DELIVERY_METHODS: ReadonlySet<string> = new Set(['ack', 'nack', 'reject']);

type ListenerFn = (...args: unknown[]) => void;

interface ReplayOp {
  readonly method: string;
  readonly args: readonly unknown[];
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/** URL sem credenciais para logs. */
function safeUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@');
}

class MqConnectionManager {
  private conn: Conn | null = null;
  private ch: Channel | null = null;
  /** Época do canal atual — muda a cada canal novo; usada na guarda de ack/nack. */
  private epoch = 0;
  private userClosed = false;
  private channelClosedByUser = false;
  private recovering = false;
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;
  private readonly replayOps: ReplayOp[] = [];
  private readonly chanListeners: { event: string; fn: ListenerFn }[] = [];
  private readonly connListeners: { event: string; fn: ListenerFn }[] = [];
  /** Mensagem entregue → época do canal que a entregou. */
  private readonly msgEpoch = new WeakMap<object, number>();
  private readonly channelProxy: Channel;
  private readonly connectionProxy: Conn;
  private handleCache: ResilientMqHandle | null = null;

  constructor(
    private readonly url: string,
    private readonly reconnect: Required<MqReconnectOptions> | null,
    private readonly logger?: RetryLogger,
  ) {
    this.channelProxy = new Proxy({} as Channel, {
      get: (_target, prop) => this.channelMember(prop),
    });
    this.connectionProxy = new Proxy({} as Conn, {
      get: (_target, prop) => this.connectionMember(prop),
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Primeira conexão: falha rápido (sem retry) — preserva a semântica de boot. */
  async open(): Promise<void> {
    const conn = await connect(this.url);
    let ch: Channel;
    try {
      ch = await conn.createChannel();
    } catch (err) {
      await Promise.resolve(conn.close()).catch(() => undefined);
      throw err;
    }
    this.adopt(conn, ch);
    this.lastConnectedAt = new Date().toISOString();
  }

  handle(): ResilientMqHandle {
    this.handleCache ??= {
      connection: this.connectionProxy,
      channel: this.channelProxy,
      isConnected: () => this.isConnected(),
      state: () => this.state(),
      close: () => this.close(),
    };
    return this.handleCache;
  }

  isConnected(): boolean {
    return this.conn !== null && this.ch !== null;
  }

  state(): MqConnectionState {
    return {
      connected: this.isConnected(),
      reconnecting: this.recovering,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
    };
  }

  async close(): Promise<void> {
    this.userClosed = true;
    managerRegistry.delete(this);
    const ch = this.ch;
    const conn = this.conn;
    this.ch = null;
    this.conn = null;
    if (ch) {
      try {
        await ch.close();
      } catch {
        /* já fechado */
      }
    }
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* já fechado */
      }
    }
  }

  private adopt(conn: Conn, ch: Channel): void {
    this.conn = conn;
    this.adoptChannel(ch);
    conn.on('error', (err: unknown) => {
      // amqplib SEMPRE emite 'close' após 'error'; aqui só registramos — sem
      // este listener o EventEmitter derrubaria o processo (uncaughtException).
      this.lastError = describeErr(err);
    });
    conn.on('close', () => {
      if (this.conn !== conn) return; // conexão antiga já substituída
      this.conn = null;
      this.ch = null;
      this.lastDisconnectedAt = new Date().toISOString();
      if (this.userClosed) return;
      this.logger?.error('mq conexão perdida — reconexão agendada', { url: safeUrl(this.url) });
      this.scheduleRecover();
    });
    for (const l of this.connListeners) conn.on(l.event, l.fn);
  }

  private adoptChannel(ch: Channel): void {
    this.ch = ch;
    this.epoch += 1;
    ch.on('error', (err: unknown) => {
      this.lastError = describeErr(err);
    });
    ch.on('close', () => {
      if (this.ch !== ch) return; // canal antigo já substituído
      this.ch = null;
      if (this.userClosed || this.channelClosedByUser) return;
      if (!this.conn) return; // queda de conexão — o handler da conexão cuida
      this.logger?.warn('mq canal fechado pelo broker — recriação agendada');
      this.scheduleRecover();
    });
    for (const l of this.chanListeners) ch.on(l.event, l.fn);
  }

  private scheduleRecover(): void {
    if (this.userClosed || this.recovering) return;
    if (!this.reconnect) {
      this.logger?.error('mq conexão perdida e reconexão DESABILITADA — handle inoperante');
      return;
    }
    this.recovering = true;
    void this.recoverLoop();
  }

  private async recoverLoop(): Promise<void> {
    try {
      while (!this.userClosed) {
        await sleep(this.nextDelayMs());
        if (this.userClosed) return;
        try {
          if (!this.conn) {
            // Reconexão completa: conexão nova + canal novo + replay do setup.
            const conn = await connect(this.url);
            let ch: Channel;
            try {
              ch = await conn.createChannel();
            } catch (err) {
              await Promise.resolve(conn.close()).catch(() => undefined);
              throw err;
            }
            this.adopt(conn, ch);
            await this.replayOn(ch);
            incMqStat('reconnects');
          } else if (!this.ch) {
            // Só o canal caiu: recria sobre a mesma conexão + replay do setup.
            const ch = await this.conn.createChannel();
            this.adoptChannel(ch);
            await this.replayOn(ch);
            incMqStat('channelRecreations');
          }
          this.consecutiveFailures = 0;
          this.lastConnectedAt = new Date().toISOString();
          this.logger?.warn('mq reconectado — setup e consumers re-registrados', {
            replayedOps: this.replayOps.length,
          });
          return;
        } catch (err) {
          this.consecutiveFailures += 1;
          this.lastError = describeErr(err);
          this.logger?.error('mq reconexão falhou — nova tentativa com backoff', {
            attempt: this.consecutiveFailures,
            error: describeErr(err),
          });
        }
      }
    } finally {
      this.recovering = false;
    }
  }

  private nextDelayMs(): number {
    const o = this.reconnect ?? DEFAULT_RECONNECT;
    const raw = Math.min(o.maxDelayMs, o.initialDelayMs * o.multiplier ** this.consecutiveFailures);
    return o.jitter ? Math.floor(raw / 2 + Math.random() * (raw / 2)) : raw;
  }

  /** Re-executa as operações de setup registradas, na ordem original. */
  private async replayOn(ch: Channel): Promise<void> {
    for (const op of this.replayOps) {
      await Promise.resolve(this.invokeOn(ch, op.method, op.args));
    }
  }

  // ------------------------------------------------------------------ facades

  private invokeOn(target: object, method: PropertyKey, args: readonly unknown[]): unknown {
    const fn = Reflect.get(target, method) as unknown;
    if (typeof fn !== 'function') {
      throw new TypeError(`amqplib: membro '${String(method)}' não é um método`);
    }
    return Reflect.apply(fn as (...a: unknown[]) => unknown, target, args as unknown[]);
  }

  /** Delegação genérica: resolve o alvo ATUAL no momento da chamada. */
  private delegated(get: () => object | null, prop: PropertyKey): unknown {
    const target = get();
    if (!target) {
      // Nunca pareça um thenable nem quebre inspeção/log durante a queda.
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (): never => {
        throw new MqNotConnectedError(String(prop));
      };
    }
    const value = Reflect.get(target, prop) as unknown;
    if (typeof value !== 'function') return value;
    return (...args: unknown[]): unknown => {
      const current = get();
      if (!current) throw new MqNotConnectedError(String(prop));
      return this.invokeOn(current, prop, args);
    };
  }

  private channelMember(prop: PropertyKey): unknown {
    if (prop === 'close') {
      return () => this.closeChannelByUser();
    }
    if (typeof prop === 'string' && SETUP_METHODS.has(prop)) {
      return (...args: unknown[]) => this.setupCall(prop, args);
    }
    if (typeof prop === 'string' && DELIVERY_METHODS.has(prop)) {
      return (...args: unknown[]) => this.deliveryCall(prop, args);
    }
    if (prop === 'get') {
      return (...args: unknown[]) => this.getCall(args);
    }
    if (prop === 'on') {
      return (event: unknown, fn: unknown): Channel => {
        if (typeof event === 'string' && typeof fn === 'function') {
          this.chanListeners.push({ event, fn: fn as ListenerFn });
          this.ch?.on(event, fn as ListenerFn);
        }
        return this.channelProxy;
      };
    }
    if (prop === 'removeListener' || prop === 'off') {
      return (event: unknown, fn: unknown): Channel => {
        if (typeof event === 'string' && typeof fn === 'function') {
          const idx = this.chanListeners.findIndex((l) => l.event === event && l.fn === fn);
          if (idx >= 0) this.chanListeners.splice(idx, 1);
          this.ch?.removeListener(event, fn as ListenerFn);
        }
        return this.channelProxy;
      };
    }
    return this.delegated(() => this.ch, prop);
  }

  private connectionMember(prop: PropertyKey): unknown {
    if (prop === 'close') {
      return () => this.close();
    }
    if (prop === 'on') {
      return (event: unknown, fn: unknown): Conn => {
        if (typeof event === 'string' && typeof fn === 'function') {
          this.connListeners.push({ event, fn: fn as ListenerFn });
          this.conn?.on(event, fn as ListenerFn);
        }
        return this.connectionProxy;
      };
    }
    if (prop === 'removeListener' || prop === 'off') {
      return (event: unknown, fn: unknown): Conn => {
        if (typeof event === 'string' && typeof fn === 'function') {
          const idx = this.connListeners.findIndex((l) => l.event === event && l.fn === fn);
          if (idx >= 0) this.connListeners.splice(idx, 1);
          this.conn?.removeListener(event, fn as ListenerFn);
        }
        return this.connectionProxy;
      };
    }
    return this.delegated(() => this.conn, prop);
  }

  /** Registra a operação de setup para replay e executa no canal atual. */
  private setupCall(method: string, args: readonly unknown[]): unknown {
    const recorded = method === 'consume' ? this.wrapConsumeArgs(args) : args;
    this.replayOps.push({ method, args: recorded });
    const ch = this.ch;
    if (!ch) return Promise.reject(new MqNotConnectedError(method));
    return this.invokeOn(ch, method, recorded);
  }

  /** Etiqueta cada mensagem entregue com a época do canal que a entregou. */
  private wrapConsumeArgs(args: readonly unknown[]): readonly unknown[] {
    const cb = args[1];
    if (typeof cb !== 'function') return args;
    const original = cb as (msg: unknown) => unknown;
    const wrapped = (msg: unknown): unknown => {
      if (msg !== null && typeof msg === 'object') this.msgEpoch.set(msg, this.epoch);
      return original(msg);
    };
    return [args[0], wrapped, ...args.slice(2)];
  }

  /**
   * `ack`/`nack`/`reject` guardados por época: mensagem de canal anterior é
   * descartada (o broker a reentrega — at-least-once) em vez de estourar
   * `PRECONDITION_FAILED (unknown delivery tag)` e derrubar o canal novo.
   */
  private deliveryCall(method: string, args: readonly unknown[]): unknown {
    const msg = args[0];
    if (msg !== null && typeof msg === 'object') {
      const bornEpoch = this.msgEpoch.get(msg);
      if (bornEpoch !== undefined && bornEpoch !== this.epoch) {
        incMqStat('staleDeliveriesDropped');
        this.logger?.warn('mq ack/nack descartado: canal foi recriado (broker reentrega)', {
          method,
        });
        return undefined;
      }
    }
    const ch = this.ch;
    if (!ch) {
      // Canal caído: a op de entrega é inócua — o broker reentrega a mensagem.
      incMqStat('staleDeliveriesDropped');
      this.logger?.warn('mq ack/nack ignorado: canal indisponível (broker reentrega)', { method });
      return undefined;
    }
    try {
      return this.invokeOn(ch, method, args);
    } catch (err) {
      this.logger?.warn('mq ack/nack falhou — mensagem ficará para reentrega', {
        method,
        error: describeErr(err),
      });
      return undefined;
    }
  }

  /** `channel.get` com etiquetagem de época no resultado (mesma guarda do consume). */
  private getCall(args: readonly unknown[]): unknown {
    const ch = this.ch;
    if (!ch) return Promise.reject(new MqNotConnectedError('get'));
    const res = this.invokeOn(ch, 'get', args);
    if (res instanceof Promise) {
      return res.then((msg: unknown) => {
        if (msg !== null && typeof msg === 'object') this.msgEpoch.set(msg, this.epoch);
        return msg;
      });
    }
    return res;
  }

  /** Fechamento explícito só do canal (app): não recriar; conexão segue viva. */
  private async closeChannelByUser(): Promise<void> {
    this.channelClosedByUser = true;
    const ch = this.ch;
    this.ch = null;
    if (ch) {
      try {
        await ch.close();
      } catch {
        /* já fechado */
      }
    }
  }
}

// ------------------------------------------------------------------- registry

const managerRegistry = new Set<MqConnectionManager>();

/**
 * Saúde agregada das conexões AMQP vivas deste processo (para /healthz —
 * F56-S17). `healthy` = todas as conexões abertas (vacuamente `true` se o
 * processo não abriu nenhuma; combine com `connections.length` se precisar
 * distinguir).
 */
export function getMqHealth(): MqHealth {
  const connections = [...managerRegistry].map((m) => m.state());
  return { healthy: connections.every((c) => c.connected), connections };
}

/** `true` se há pelo menos uma conexão gerenciada e TODAS estão abertas. */
export function isMqConnected(): boolean {
  return managerRegistry.size > 0 && getMqHealth().healthy;
}

/**
 * Abre uma conexão AMQP gerenciada (auto-reconnect + re-registro de consumers).
 * Assinatura retro-compatível: `connectMq()` / `connectMq(url)` seguem valendo;
 * o retorno é aditivo (`ResilientMqHandle` ⊃ `MqHandle`).
 *
 * A PRIMEIRA conexão falha rápido (comportamento de boot preservado); a
 * reconexão automática só atua após o primeiro sucesso.
 */
export async function connectMq(
  url = process.env['AMQP_URL'],
  opts: ConnectMqOptions = {},
): Promise<ResilientMqHandle> {
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: AMQP_URL');
  const reconnect = opts.reconnect === false ? null : { ...DEFAULT_RECONNECT, ...opts.reconnect };
  const manager = new MqConnectionManager(url, reconnect, opts.logger);
  await manager.open();
  managerRegistry.add(manager);
  return manager.handle();
}
