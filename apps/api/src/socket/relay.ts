/**
 * Socket relay (F1-S11 / LIVECHAT.md §6). Consome `hm.q.socket.relay` no
 * RabbitMQ e reemite cada evento via Socket.io para as rooms corretas:
 * `conversation:{id}`, `ws:{workspaceId}` e `member:{id}`.
 *
 * O `Envelope.payload` carrega `{ event, room?, target?, data }`. Validamos o
 * shape com Zod no boundary (proibido `any`).
 *
 * ## F56-S16 — confiabilidade do caminho quente (INF-09 / INF-11 / INF-13 / PERF-04-05)
 *
 * O relay é o ÚLTIMO trecho entre o banco e o navegador: se ele engole um
 * evento, o sintoma é o famoso "o tempo real some às vezes". Três garantias
 * agora são estruturais:
 *
 * 1. **O emit nunca depende do Redis.** Antes, `await bumpVersion()` rodava
 *    dentro do try do handler e ANTES do emit: qualquer falha/lentidão do Redis
 *    derrubava o `message:new` (o consumer nack-dropa em erro). Hoje o bump é
 *    best-effort e com **prazo** ({@link BUMP_TIMEOUT_MS}): falhou ou estourou o
 *    prazo → emitimos assim mesmo. Nenhum caminho de erro do cache alcança o emit.
 *
 *    Por que o bump continua ANTES do emit no caminho feliz (e não depois, como
 *    "emitir primeiro" sugeriria ao pé da letra): o cliente REAGE ao evento
 *    fazendo refetch da ChatList (GET /api/conversations, cache versionado de
 *    120s). Se a versão ainda não foi bumpada quando esse refetch chega, ele lê a
 *    lista VELHA — exatamente a regressão que o fix da intermitência (commit
 *    4fe4b0ff) corrigiu. A ordem preserva a correção; o **prazo** remove o
 *    acoplamento de disponibilidade. Melhor dos dois: fresco quando o Redis está
 *    são, entregue de qualquer jeito quando não está.
 *
 * 2. **Bump coalescido por workspace** (PERF-05). Numa rajada, N mensagens do
 *    mesmo workspace geravam N INCRs → N versões distintas → cada refetch dos M
 *    operadores online caía num miss diferente (cache stampede ∝ M × taxa).
 *    Agora os eventos que chegam enquanto um INCR está em voo compartilham UM
 *    único INCR seguinte ({@link createVersionBumper}) — sem atraso artificial e
 *    sem perder invalidação (o INCR compartilhado só COMEÇA depois que todos os
 *    eventos que o compartilham chegaram, então nenhum cache populado antes deles
 *    sobrevive).
 *
 * 3. **Prefetch + log frio.** O consumer tinha prefetch ilimitado (uma rajada
 *    inteira era empurrada para a memória do processo da API) e logava um `info`
 *    por emit (log flood no caminho mais quente do produto). Agora:
 *    {@link RELAY_PREFETCH} e log por-emit em `debug` (gated — nem a contagem de
 *    sockets é calculada em produção).
 */
import { z } from 'zod';
import { connectMq, consume, type Envelope } from '@hm/shared/mq';
import { SERVER_TO_CLIENT_EVENTS, type ServerToClientEvent } from '@hm/shared';
import { createLogger, type LogLevel, type Logger } from '@hm/logger';
import { bumpVersion } from '../cache';
import { notifyInboundMessage } from '../services/notifications/from-inbound';
import type { IoServer } from './index';

const RELAY_QUEUE = 'hm.q.socket.relay';

/**
 * Teto de mensagens não-ackadas entregues ao processo (INF-11). Sem isto o
 * broker empurra a fila inteira de uma vez: pico de memória na API e nenhuma
 * chance de o RabbitMQ balancear entre réplicas. 100 dá vazão de sobra (o
 * handler é sub-ms) mantendo o buffer limitado.
 */
export const RELAY_PREFETCH = 100;

/**
 * Prazo do bump de cache antes de emitir mesmo assim. Redis são responde em
 * ~1ms; este teto só existe para o dia ruim (blip/hang), quando entregar o
 * evento vale mais que a frescura da lista.
 */
export const BUMP_TIMEOUT_MS = 250;

/**
 * Eventos que mudam a PROJEÇÃO da ChatList (preview, ordem, contador de não-lidas,
 * badges de status/atribuição/IA). Para estes, além de emitir no socket, bumpamos
 * a versão do cache versionado da lista (`hm:ws:v:{workspaceId}`, TTL 120s) — senão
 * o refetch do cliente (disparado pelo próprio evento) recebe a lista CACHEADA e
 * VELHA (preview/ordem/unread defasados por até 120s). Antes, o único bump era a
 * rota POST /:id/read → a lista só renovava ao marcar-lida; mensagem nova não
 * atualizava preview/contador em tempo real. `message:status_changed`/media/typing
 * NÃO entram aqui (não mudam a lista e são alta-frequência → manteria o cache vivo).
 */
const LIST_AFFECTING_EVENTS: ReadonlySet<ServerToClientEvent> = new Set([
  'message:new',
  'conversation:updated',
  'conversation:state_changed',
  'conversation:assigned',
  'conversation:routing_changed',
  'conversation:ai_mode_changed',
  'conversation:agent_changed',
]);

/** Chave da versão do cache da ChatList de um workspace (contrato com `../cache`). */
function listVersionKey(workspaceId: string): string {
  return `hm:ws:v:${workspaceId}`;
}

const LOG_LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

/** Nível efetivo do logger do relay (LOG_LEVEL > NODE_ENV), igual ao de `src/index.ts`. */
function resolveLogLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'];
  if (raw !== undefined && LOG_LEVELS.has(raw)) return raw as LogLevel;
  return process.env['NODE_ENV'] === 'development' ? 'debug' : 'info';
}

/** Alvo de roteamento dentro de um workspace. */
const relayTargetSchema = z.object({
  conversationId: z.string().optional(),
  memberId: z.string().optional(),
  /** Quando true, emite também para a room do workspace inteiro. */
  workspace: z.boolean().optional(),
});

/** Shape do payload de relay transportado no Envelope. */
const relayPayloadSchema = z.object({
  event: z.enum(SERVER_TO_CLIENT_EVENTS),
  /** Room explícita (sobrepõe o roteamento por `target`). */
  room: z.string().optional(),
  target: relayTargetSchema.optional(),
  data: z.unknown(),
});

type RelayPayload = z.infer<typeof relayPayloadSchema>;

/** Resolve as rooms destino a partir do envelope + payload. */
function resolveRooms(payload: RelayPayload, workspaceId: string): string[] {
  if (payload.room) return [payload.room];

  const rooms = new Set<string>();
  const target = payload.target;
  if (target?.conversationId) rooms.add(`conversation:${target.conversationId}`);
  if (target?.memberId) rooms.add(`member:${target.memberId}`);
  if (target?.workspace) rooms.add(`ws:${workspaceId}`);

  // Sem alvo específico → workspace inteiro (default seguro).
  if (rooms.size === 0) rooms.add(`ws:${workspaceId}`);
  return [...rooms];
}

/**
 * Portas do handler — funções puras em vez do `Server` do Socket.io, para que o
 * caminho crítico (ordem bump→emit, prazo, coalescência) seja testável sem
 * subir servidor/Redis/RabbitMQ.
 */
export interface RelayPorts {
  /** Entrega o evento nas rooms. Único efeito colateral obrigatório do handler. */
  readonly emit: (rooms: readonly string[], event: ServerToClientEvent, data: unknown) => void;
  /** Invalida a versão do cache da ChatList. Pode falhar/pendurar — o relay se protege. */
  readonly bumpVersion?: (versionKey: string) => Promise<void>;
  /** Nº de sockets numa room (só avaliado quando o log de emit está ligado). */
  readonly countSockets?: (room: string) => number;
  readonly logger?: Logger;
  /** Prazo do bump; default {@link BUMP_TIMEOUT_MS}. */
  readonly bumpTimeoutMs?: number;
  /** Log por-emit (contagem de sockets). Default: só quando o nível é `debug`. */
  readonly logEmits?: boolean;
  /**
   * Aviso ao membro (F61-S04). Injetável para o teste do relay não depender de
   * banco nem de push — e para o relay poder ser testado provando que NÃO espera
   * por ele.
   */
  readonly notifyInbound?: (input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
  }) => Promise<void>;
}

/** Resolve `p` ou rejeita ao estourar `ms` — o trabalho pendente segue solto (best-effort). */
function withDeadline(p: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`bump de cache excedeu ${ms}ms`));
    }, ms);
    timer.unref();
    p.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

/** Estado de coalescência de UM workspace. */
interface BumpChain {
  /** INCR já INICIADO — não cobre eventos que chegaram depois de ele começar. */
  running: Promise<void> | null;
  /** INCR agendado e ainda NÃO iniciado — cobre todo evento que chegar até lá. */
  queued: Promise<void> | null;
}

/**
 * Bumper de versão: best-effort (nunca lança), com prazo e coalescência por
 * workspace.
 *
 * Invariante de correção da coalescência: um evento só compartilha um INCR que
 * ainda NÃO começou. Como a mensagem já está persistida quando chega aqui, um
 * INCR iniciado depois da chegada dela invalida qualquer entrada de cache
 * populada antes dela — logo o refetch pós-emit lê dados que a incluem. (Juntar-se
 * a um INCR já EM VOO seria incorreto: ele pode ter começado antes desta escrita.)
 */
export function createVersionBumper(
  bump: (versionKey: string) => Promise<void>,
  log: Logger,
  timeoutMs: number,
): (workspaceId: string) => Promise<void> {
  const chains = new Map<string, BumpChain>();
  let degraded = false;

  async function runBump(workspaceId: string): Promise<void> {
    try {
      const inflight = bump(listVersionKey(workspaceId));
      // O trabalho excedente ao prazo segue em background — mas sem rejection solta.
      inflight.catch(() => undefined);
      await withDeadline(inflight, timeoutMs);
      if (degraded) {
        degraded = false;
        log.info('bump da ChatList normalizado');
      }
    } catch (err) {
      // NUNCA propaga: o cache é um acelerador, não uma dependência de entrega.
      // Loga só a TRANSIÇÃO são→degradado (INF-13: nada de flood no caminho quente).
      if (!degraded) {
        degraded = true;
        log.warn('bump da ChatList falhou — emitindo assim mesmo (lista pode ficar até 120s velha)', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return function bumpListVersion(workspaceId: string): Promise<void> {
    const chain: BumpChain = chains.get(workspaceId) ?? { running: null, queued: null };
    chains.set(workspaceId, chain);

    // Já há um INCR agendado que ainda não começou → ele cobre este evento.
    if (chain.queued) return chain.queued;

    const startAfter = chain.running ?? Promise.resolve();
    const queued: Promise<void> = startAfter.then(async () => {
      // Daqui pra frente o INCR está EM VOO: quem chegar agora precisa de outro.
      if (chain.queued === queued) chain.queued = null;
      chain.running = queued;
      await runBump(workspaceId);
    });
    chain.queued = queued;

    void queued.finally(() => {
      if (chain.running === queued) chain.running = null;
      if (chain.queued === queued) chain.queued = null;
      if (!chain.running && !chain.queued && chains.get(workspaceId) === chain) {
        chains.delete(workspaceId);
      }
    });

    return queued;
  };
}

/**
 * Handler do relay (fábrica testável). Contrato:
 *  - payload inválido → loga e ACKa (erro de conteúdo; retry não conserta);
 *  - evento que muda a lista → bump best-effort com prazo, DEPOIS emit;
 *  - qualquer falha do cache → emite mesmo assim.
 */
export function createRelayHandler(ports: RelayPorts): (envelope: Envelope) => Promise<void> {
  const log = ports.logger ?? createLogger(resolveLogLevel(), { svc: 'socket-relay' });
  const logEmits = ports.logEmits ?? resolveLogLevel() === 'debug';
  const bumpListVersion = createVersionBumper(
    ports.bumpVersion ?? bumpVersion,
    log,
    ports.bumpTimeoutMs ?? BUMP_TIMEOUT_MS,
  );

  return async function handleRelayEnvelope(envelope: Envelope): Promise<void> {
    const parsed = relayPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      // Erro de conteúdo: nack/retry não conserta. Antes isto era um throw que o
      // consumer descartava em silêncio — agora fica visível.
      log.error('payload de relay inválido — evento descartado', {
        envelopeId: envelope.id,
        type: envelope.type,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    const payload = parsed.data;
    const event: ServerToClientEvent = payload.event;
    const rooms = resolveRooms(payload, envelope.workspaceId);

    // Invalida o cache versionado da ChatList ANTES de notificar o cliente (o
    // refetch disparado pelo evento precisa ler dados frescos). Best-effort e com
    // prazo: nem falha nem lentidão do Redis pode impedir o emit abaixo.
    if (LIST_AFFECTING_EVENTS.has(event)) {
      await bumpListVersion(envelope.workspaceId);
    }

    if (logEmits) {
      const counts = rooms.map((r) => `${r}=${ports.countSockets?.(r) ?? 0}`);
      log.debug('relay emit', { event, rooms: counts });
    }

    // io aceita evento arbitrário (DefaultEventsMap); o shape do `data` é o
    // contrato tipado de socket-events validado na publicação.
    ports.emit(rooms, event, payload.data);

    // F61-S04 — o dono no celular. Sai DEPOIS do emit e sem `await`: o relay é o
    // último trecho entre o banco e o navegador, e nada aqui pode atrasar ou
    // derrubar o tempo real. Um aviso perdido é ruim; "o tempo real some às
    // vezes" é um bug caro de diagnosticar.
    if (event === 'message:new') {
      const alvo = inboundParaNotificar(payload.data);
      if (alvo !== null) {
        // `.catch()` explícito, não só `void`: `void` descarta o VALOR, não a
        // rejeição — uma promise rejeitada aqui viraria unhandled rejection e,
        // dependendo da configuração do Node, derrubaria o processo da API
        // inteira por causa de um aviso que não saiu.
        (ports.notifyInbound ?? notifyInboundMessage)({
          workspaceId: envelope.workspaceId,
          conversationId: alvo.conversationId,
          messageId: alvo.messageId,
        }).catch((err: unknown) => {
          log.warn('aviso de inbound falhou — o tempo real seguiu normalmente', {
            erro: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  };
}

/**
 * Extrai do `message:new` o que a notificação precisa — e devolve `null` quando
 * não há nada a notificar.
 *
 * Só mensagem **do contato** vira aviso: notificar o dono da própria resposta que
 * ele acabou de mandar é a forma mais rápida de ele desligar as notificações.
 *
 * `data` é `unknown` no contrato do relay (o shape é validado na publicação), por
 * isso o parse defensivo aqui: um payload de uma versão futura do worker não pode
 * derrubar o relay.
 */
export function inboundParaNotificar(
  data: unknown,
): { conversationId: string; messageId: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const raiz = data as Record<string, unknown>;
  const conversationId = raiz['conversationId'];
  const message = raiz['message'];
  if (typeof conversationId !== 'string' || typeof message !== 'object' || message === null) {
    return null;
  }
  const msg = message as Record<string, unknown>;
  if (msg['senderType'] !== 'contact') return null;
  const messageId = msg['id'];
  if (typeof messageId !== 'string') return null;
  return { conversationId, messageId };
}

/**
 * Inicia o consumer do relay. Resolve quando o consumer está registrado.
 * Lança em falha de conexão — o caller (createSocketServer) trata sem derrubar
 * o boot.
 */
export async function startSocketRelay(io: IoServer): Promise<void> {
  const { channel } = await connectMq();
  await channel.assertQueue(RELAY_QUEUE, { durable: true });
  await channel.prefetch(RELAY_PREFETCH);

  const handler = createRelayHandler({
    emit: (rooms, event, data) => {
      io.to([...rooms]).emit(event, data);
    },
    countSockets: (room) => io.of('/').adapter.rooms.get(room)?.size ?? 0,
  });

  await consume(channel, RELAY_QUEUE, handler);
}

export { RELAY_QUEUE };
