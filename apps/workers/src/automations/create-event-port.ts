/**
 * Port `create_event` das automacoes de stage (F53-S07).
 *
 * Liga a action `create_event` (PIPELINE.md 3.1) ao NUCLEO UNICO de persistencia
 * de eventos — `@hm/db.calendarRepo.createEvent` (extraido em F53-S08). NAO duplica
 * o insert de evento: monta o `CreateEventInput` a partir do contexto da automacao
 * e delega ao repo dentro de uma transacao RLS-escopada (GUC `app.workspace_id`
 * preenchido por `withWorkspace` — F40-S01).
 *
 * As dependencias (scope RLS, lookup do deal, criacao) sao INJETADAS para o port
 * ser testavel sem DB; `liveCreateEventPortDeps()` faz o wiring real com `@hm/db`
 * e e o que o bootstrap usa.
 *
 * Contrato do `config` (espelha `@hm/db` AutomationRuleConfig p/ `create_event`):
 *   `{ calendarId, title, durationMinutes, offsetDays }`. O `offsetDays` define o
 *   inicio relativo ("daqui N dias", a partir de agora) e `durationMinutes` a duracao.
 *   `type`/`priority` nao vivem no config persistido (schema da rule e travado em
 *   `@hm/db`, fora da fronteira deste slot) → caem nos defaults do repo
 *   (`type='meeting'`, `priority='medium'`). Quando a rule ganhar esses campos,
 *   basta repassa-los aqui.
 */
import { Buffer } from 'node:buffer';
import { calendarRepo, schema, withWorkspace, type CreateEventInput, type DbTx, type Event } from '@hm/db';
import { eq } from 'drizzle-orm';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { EventChangedPayload, ServerToClientEvent } from '@hm/shared';
import { createLogger, type Logger } from '@hm/logger';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Canal AMQP (mesma fila/transporte que o relay do socket usa). */
type MqChannel = MqHandle['channel'];

/** Fila de relay do socket (mesma constante de apps/api/src/socket/relay.ts + calendar-reminders). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Evento Server→Client de compromisso criado (definido em @hm/shared por F54-S01). */
const EVENT_CREATED_EVENT: ServerToClientEvent = 'event:created';

/** Config persistido da action `create_event` (sem o discriminante `kind`). */
export interface CreateEventConfig {
  readonly calendarId: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly offsetDays: number;
}

/** Contexto da automacao (o que o executor passa ao port). */
export interface CreateEventPortCtx {
  readonly workspaceId: string;
  readonly dealId: string;
}

/** Referencia do deal resolvida sob a tx escopada (contato/conversa do compromisso). */
export interface DealEventRef {
  readonly contactId: string | null;
  readonly conversationId: string | null;
}

export interface CreateEventPortDeps {
  /** Roda `fn` sob RLS-scope do workspace (GUC `app.workspace_id` preenchido). */
  readonly runScoped: <T>(workspaceId: string, fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  /** Resolve contato/conversa do deal (sob a tx); `null` se o deal sumiu. */
  readonly resolveDeal: (tx: DbTx, dealId: string) => Promise<DealEventRef | null>;
  /** Nucleo unico de criacao de evento — reusado da API (`@hm/db`). */
  readonly createEvent: (tx: DbTx, input: CreateEventInput) => Promise<Event>;
  /**
   * Publica `event:created` no relay do socket (F54-S01/F54-S04) APOS a criacao,
   * para a Agenda/Cockpit atualizar sem refresh. Best-effort: falha de publish
   * NAO derruba a automacao (a persistencia ja aconteceu). Opcional — sem ele a
   * criacao nao emite socket (compat com testes que nao precisam do relay).
   */
  readonly emitCreated?: (payload: EventChangedPayload) => void;
  /** Relogio injetavel (testes deterministicos de offset). Default: `Date`. */
  readonly now?: () => Date;
}

/** Tipo do port `createEvent` consumido pelo executor das automacoes. */
export type CreateEventPort = (ctx: CreateEventPortCtx, config: CreateEventConfig) => Promise<void>;

/**
 * Constroi o port `create_event` a partir das dependencias injetadas. Resolve
 * `startAt = agora + offsetDays` e `endAt = startAt + durationMinutes`, deriva
 * contato/conversa do deal e delega ao nucleo de criacao. `createdBy`/
 * `createdByAgentId` ficam `null` = autor SISTEMA/AUTOMACAO (a API resolveria do
 * actor humano/agente). Se o deal nao existe mais, no-op idempotente.
 */
export function createCalendarEventPort(deps: CreateEventPortDeps): CreateEventPort {
  const clock = deps.now ?? ((): Date => new Date());
  return async (ctx, config) => {
    const startAt = new Date(clock().getTime() + config.offsetDays * DAY_MS);
    const endAt = new Date(startAt.getTime() + config.durationMinutes * MINUTE_MS);
    // Roda a criacao sob RLS-scope e devolve o payload de socket SO se criou de
    // fato (deal ainda existe). Emitir fora do `runScoped` garante publish apenas
    // apos a tx commitar (nunca anuncia um evento que rolou back).
    const payload = await deps.runScoped(ctx.workspaceId, async (tx): Promise<EventChangedPayload | null> => {
      const deal = await deps.resolveDeal(tx, ctx.dealId);
      if (!deal) return null;
      const input: CreateEventInput = {
        workspaceId: ctx.workspaceId,
        // `''` (sem calendar explicito) → repo cai no calendario "Empresa" (default).
        calendarId: config.calendarId.length > 0 ? config.calendarId : null,
        title: config.title,
        startAt,
        endAt,
        contactId: deal.contactId,
        conversationId: deal.conversationId,
        dealId: ctx.dealId,
        // Autor = sistema/automacao (sem member/agente humano).
        createdBy: null,
        createdByAgentId: null,
        metadata: { source: 'automation', ruleKind: 'create_event' },
      };
      const created = await deps.createEvent(tx, input);
      return {
        eventId: created.id,
        workspaceId: ctx.workspaceId,
        contactId: deal.contactId,
        conversationId: deal.conversationId,
        kind: 'created',
      };
    });
    if (payload) {
      // Best-effort: o socket e side-effect; a criacao ja persistiu. Um emitter
      // que lance (sync) nao pode derrubar a automacao.
      try {
        deps.emitCreated?.(payload);
      } catch {
        /* swallow — o emitter real ja loga; aqui so garantimos "segue". */
      }
    }
  };
}

/**
 * Constroi o emitter best-effort de `event:created` no relay do socket
 * (`hm.q.socket.relay`), reusando a MESMA mecanica do worker `calendar-reminders`
 * e do servico `event-realtime` da API (S01): envelope `socket.relay` com
 * `{ event, target, data }`, publicado via `sendToQueue` persistente.
 *
 * Como o bootstrap das automacoes nao injeta um canal AMQP no port (ele constroi
 * `liveCreateEventPortDeps()` sem transporte), o emitter abre a propria conexao
 * SOB DEMANDA (memoizada — uma por processo) na primeira emissao. Se um `channel`
 * de boot for fornecido, ele e reusado. Falha (broker indisponivel / sem
 * `AMQP_URL`) e logada e engolida — nunca propaga p/ a automacao.
 */
function makeRelayEmitter(logger: Logger, bootChannel?: MqChannel): (payload: EventChangedPayload) => void {
  let handlePromise: Promise<MqHandle> | null = null;
  const resolveChannel = async (): Promise<MqChannel> => {
    if (bootChannel) return bootChannel;
    handlePromise ??= connectMq();
    return (await handlePromise).channel;
  };
  return (payload) => {
    // Fire-and-forget: a automacao nao espera o publish (side-effect best-effort).
    void (async () => {
      try {
        const channel = await resolveChannel();
        const envelope = makeEnvelope('socket.relay', payload.workspaceId, {
          event: EVENT_CREATED_EVENT,
          target: { workspace: true },
          data: payload,
        });
        channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: 'application/json',
        });
      } catch (err: unknown) {
        logger.warn('create-event-port: falha ao publicar event:created (best-effort)', {
          eventId: payload.eventId,
          workspaceId: payload.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };
}

/** Opcoes do wiring real do port (transporte de socket + logger). */
export interface LiveCreateEventPortOptions {
  /**
   * Canal AMQP ja aberto (ex.: transporte de boot). Se ausente, o emitter abre a
   * propria conexao sob demanda — mantem o port self-contained sem exigir wiring
   * no bootstrap.
   */
  readonly channel?: MqChannel;
  /** Logger estruturado (falha de publish e best-effort + logada). */
  readonly logger?: Logger;
}

/**
 * Wiring real do port com `@hm/db`: scope via `withWorkspace`, lookup do deal sob
 * a mesma tx e delegacao a `calendarRepo.createEvent`. Usado pelo bootstrap.
 */
export function liveCreateEventPortDeps(options: LiveCreateEventPortOptions = {}): CreateEventPortDeps {
  const logger =
    options.logger ?? createLogger('info', { svc: '@hm/workers', mod: 'create-event-port' });
  return {
    runScoped: (workspaceId, fn) => withWorkspace(workspaceId, fn),
    resolveDeal: async (tx, dealId) => {
      const [deal] = await tx
        .select({
          contactId: schema.deals.contactId,
          conversationId: schema.deals.conversationId,
        })
        .from(schema.deals)
        .where(eq(schema.deals.id, dealId))
        .limit(1);
      return deal ? { contactId: deal.contactId, conversationId: deal.conversationId } : null;
    },
    createEvent: (tx, input) => calendarRepo.createEvent(tx, input),
    emitCreated: makeRelayEmitter(logger, options.channel),
  };
}
