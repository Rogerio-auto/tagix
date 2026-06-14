/**
 * Reengajamento de IA por gatilho — cron idempotente (F30-S06, LIVECHAT_OPS.md §2).
 *
 * Tick periódico que reengaja automaticamente a IA em conversas elegíveis. Dois
 * gatilhos independentes, ambos aplicados numa mesma varredura:
 *
 * **1. Ocioso (idle):** conversa com `ai_mode='paused'` +
 *   `ai_paused_reason='human_takeover'` onde `ai_last_human_at` excede a janela
 *   ociosa do workspace (default 60 min, env `REENGAGEMENT_IDLE_MINUTES`). Indica
 *   que o atendente saiu sem resolver — a IA retoma para continuar o atendimento.
 *
 * **2. Fora de horário comercial:** mensagem do contato pendente (conversa
 *   `ai_mode='paused'` + `last_message_from='contact'`) que estava fora do horário
 *   comercial quando chegou. Quando o cron roda E o momento atual está DENTRO do
 *   horário configurado no workspace (`settings.business_hours`), a IA retoma com
 *   contexto — o atendimento humano está disponível e a IA pode reengajar.
 *
 * ```
 * tick (a cada REENGAGEMENT_TICK_MS):
 *   acquireSchedulerLock(redis, hm:lock:scheduler:reengagement)
 *     descobre workspaces com conversas ai_mode='paused' + reason='human_takeover'
 *       [getDb(), cross-tenant — o mesmo padrão de followup.ts / metrics.ts]
 *     por workspace, sob RLS (withWorkspace):
 *       SELECT elegíveis (idle OU fora-de-horário-agora-dentro)
 *       para cada conversa:
 *         markReengagement(redis, conv, bucket)  ← SET NX (idempotência)
 *           se já marcada → pula
 *         UPDATE conversations SET ai_mode='on', ai_paused_reason=null, ...
 *         publish flow.run.requested → hm.q.flows
 *   release()
 * ```
 *
 * **Idempotência:** chave Redis `hm:reengagement:done:{conversationId}:{bucket}`
 * onde `bucket` é o epoch-seg de `ai_last_human_at` (gatilho idle) ou de
 * `last_message_at` (gatilho fora de horário) — o ponto fixo da janela. Enquanto
 * a IA não for pausada novamente (o que reseta `ai_last_human_at`), o mesmo bucket
 * persiste e o segundo tick pula. TTL = 7 dias. Atômico via `SET NX`.
 *
 * **Scheduler singleton:** lock Redis `hm:lock:scheduler:reengagement` (`SET NX PX`)
 * com TTL 30 s. Idêntico ao padrão de `followup.ts` e demais schedulers.
 *
 * **Retomada consciente de contexto (S05):** ao publicar `flow.run.requested`, o
 * runtime Python (LangGraph) lê a coluna `ai_paused_reason` (gravada pelo S04) e
 * injeta a diretriz de handoff — a IA retoma ciente de que um humano atuou.
 * Aqui apenas limpamos `ai_paused_reason`/`ai_paused_at`/`ai_paused_by` DEPOIS de
 * publicar o envelope (a ordem garante que o runtime ainda lê o motivo antes do
 * update). UPDATE e publish acontecem na mesma transação de workspace.
 */
import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { makeEnvelope, QUEUES, type MqHandle } from '@hm/shared/mq';
import { CHANNEL_PROVIDERS, type ChannelProvider } from '@hm/shared';
import type { Logger } from '@hm/logger';

/** Canal AMQP derivado de `@hm/shared/mq`. */
type MqChannel = MqHandle['channel'];

/** Fila canônica de flows/agentes (mesma do followup.ts e do worker de F2-S11). */
export const REENGAGEMENT_FLOWS_QUEUE = QUEUES.flows;

/** Tipo do envelope de disparo — mesmo do worker de agentes e do followup.ts. */
export const REENGAGEMENT_RUN_TYPE = 'flow.run.requested' as const;

/** Chave do lock de scheduler (singleton — só uma instância roda o tick). */
export const REENGAGEMENT_LOCK_KEY = 'hm:lock:scheduler:reengagement' as const;

/** TTL do lock de scheduler: cobre um tick com folga (auto-expira se travar). */
export const REENGAGEMENT_LOCK_TTL_MS = 30_000;

/** Período default entre ticks (env `REENGAGEMENT_TICK_MS`, default 60 s). */
export const DEFAULT_REENGAGEMENT_TICK_MS = 60_000;

/** Janela ociosa default: 60 min (env `REENGAGEMENT_IDLE_MINUTES`). */
export const DEFAULT_IDLE_MINUTES = 60;

/** TTL da marca de idempotência (7 d — cobre janela estendida IG, auto-expira). */
const REENGAGEMENT_MARK_TTL_SEC = 7 * 24 * 60 * 60;

// ─── Redis port (idêntica à de followup.ts) ───────────────────────────────────

/**
 * Subconjunto mínimo de `ioredis` que este job usa. Satisfeito por qualquer
 * instância real de `ioredis` (que já é dep do bootstrap). Declarado como porta
 * para permitir mock nos testes sem acoplar o código de domínio ao pacote.
 */
export interface ReengagementRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSec: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Script Lua de unlock (check-and-del — só o titular libera o próprio lock). */
const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Callback de liberação do lock. Idempotente (chama uma vez). */
export type ReleaseLock = () => Promise<void>;

/**
 * Adquire o lock de scheduler via `SET NX PX` com token aleatório. Resolve com
 * a função de liberação se vencer, `null` se outra instância já detém o lock.
 */
export async function acquireReengagementLock(
  redis: ReengagementRedis,
  key: string,
  ttlMs: number,
): Promise<ReleaseLock | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(UNLOCK_LUA, 1, key, token);
  };
}

// ─── Business-hours evaluation ────────────────────────────────────────────────

/**
 * Shape do `settings.business_hours` do workspace (salvo por F8-S07).
 * Reflete `businessHoursSchema` de `apps/api/src/routes/workspace/workspace.ts`.
 */
interface BusinessHoursDay {
  open: boolean;
  from?: string; // "HH:MM"
  to?: string;   // "HH:MM"
}

interface BusinessHours {
  enabled: boolean;
  timezone?: string;
  days?: BusinessHoursDay[];
  awayMessage?: string;
}

/** Parser Zod-free de `settings.business_hours` (validação mínima defensiva). */
function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const bh = raw as Record<string, unknown>;
  if (typeof bh['enabled'] !== 'boolean') return null;
  return {
    enabled: bh['enabled'] as boolean,
    timezone: typeof bh['timezone'] === 'string' ? bh['timezone'] : undefined,
    days: Array.isArray(bh['days']) ? (bh['days'] as BusinessHoursDay[]) : undefined,
    awayMessage:
      typeof bh['awayMessage'] === 'string' ? bh['awayMessage'] : undefined,
  };
}

/**
 * Converte "HH:MM" para minutos-desde-meia-noite. `null` se inválido.
 */
function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  const h = parts[0] !== undefined ? parseInt(parts[0], 10) : NaN;
  const m = parts[1] !== undefined ? parseInt(parts[1], 10) : NaN;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Avalia se `now` está dentro do horário comercial configurado no workspace.
 * `now` é passado como parâmetro para testabilidade (sem `Date.now()` interno).
 *
 * Retorna `false` se:
 * - `business_hours` não configurado ou `enabled=false`;
 * - o dia-da-semana não está aberto;
 * - o horário atual está fora da janela from/to do dia.
 *
 * Retorna `true` se `enabled=true` e o instante cai dentro de um dia aberto
 * com hora atual ≥ from e ≤ to.
 */
export function isWithinBusinessHours(settings: Record<string, unknown>, now: Date): boolean {
  const raw = settings['business_hours'];
  const bh = parseBusinessHours(raw);
  if (!bh || !bh.enabled) return false;
  if (!bh.days || bh.days.length === 0) return false;

  // Ajusta `now` pelo fuso do workspace. Usa o offset UTC do timezone nomeado
  // via Intl se disponível; caso contrário, permanece em UTC.
  if (bh.timezone) {
    try {
      // Converte para o fuso configurado extraindo a hora local.
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: bh.timezone,
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short',
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';

      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayIndex = weekdays.indexOf(get('weekday'));
      if (dayIndex === -1) return false;

      const hourStr = get('hour');
      const minStr = get('minute');
      const h = parseInt(hourStr === '24' ? '0' : hourStr, 10);
      const m = parseInt(minStr, 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return false;

      const dayConfig = bh.days[dayIndex];
      if (!dayConfig?.open) return false;

      const currentMin = h * 60 + m;
      const fromMin = toMinutes(dayConfig.from);
      const toMin = toMinutes(dayConfig.to);
      if (fromMin === null || toMin === null) return false;
      return currentMin >= fromMin && currentMin <= toMin;
    } catch {
      // Timezone inválido — fallback: considera fora do horário.
      return false;
    }
  }

  // Sem timezone configurado: avalia em UTC.
  const day = now.getUTCDay();
  const dayConfig = bh.days[day];
  if (!dayConfig?.open) return false;

  const currentMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fromMin = toMinutes(dayConfig.from);
  const toMin = toMinutes(dayConfig.to);
  if (fromMin === null || toMin === null) return false;
  return currentMin >= fromMin && currentMin <= toMin;
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

/** Gatilho que qualificou esta conversa para reengajamento. */
export type ReengagementReason = 'idle' | 'business_hours';

/** Conversa elegível a reengajamento resolvida dentro do tenant (RLS). */
export interface EligibleReengagementConversation {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channelId: string;
  readonly provider: ChannelProvider;
  /** Epoch-seg usado como bucket de idempotência (ai_last_human_at ou last_message_at). */
  readonly windowBucket: number;
  /** Razão do reengajamento (para logging e potencial diretriz no contexto). */
  readonly reason: ReengagementReason;
}

/** Linha crua do SELECT de elegibilidade (postgres-js). */
type EligibleRow = {
  conversation_id: string;
  contact_id: string;
  channel_id: string;
  provider: string;
  bucket_epoch: number;
  reason: string;
} & Record<string, unknown>;

/**
 * Lê a configuração de idle do ambiente (`REENGAGEMENT_IDLE_MINUTES`, default 60).
 */
export function idleMinutesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['REENGAGEMENT_IDLE_MINUTES'];
  if (raw === undefined || raw.length === 0) return DEFAULT_IDLE_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IDLE_MINUTES;
}

/**
 * Descobre workspaces com conversas candidatas a reengajamento: `ai_mode='paused'`
 * + `ai_paused_reason='human_takeover'`. Cross-tenant (getDb() direto — passo de
 * enumeração de tenants, fora de escopo RLS, idêntico ao followup.ts / metrics.ts).
 */
async function workspacesWithPausedConversations(): Promise<string[]> {
  const rows = await getDb().execute<{ workspace_id: string } & Record<string, unknown>>(sql`
    select distinct workspace_id
    from conversations
    where ai_mode = 'paused'
      and ai_paused_reason = 'human_takeover'
      and status in ('open', 'pending')
  `);
  return [...rows].map((r) => r.workspace_id);
}

/**
 * Shape mínimo do workspace lido para avaliação de horário comercial.
 */
type WorkspaceSettings = { settings: Record<string, unknown> };

/**
 * Seleciona conversas elegíveis do tenant atual (RLS). Elegível:
 *
 * **Gatilho idle:**
 * - `ai_mode = 'paused'` + `ai_paused_reason = 'human_takeover'`
 * - `ai_last_human_at IS NOT NULL`
 * - `ai_last_human_at <= now - idle_sec` (a ociosidade expirou)
 * - `status IN ('open', 'pending')`, `contact_id IS NOT NULL`
 *
 * **Gatilho fora-de-horário (avaliado pelo caller após checar se NOW está dentro):**
 * - `ai_mode = 'paused'` + `ai_paused_reason = 'human_takeover'`
 * - `last_message_from = 'contact'` (há mensagem pendente do contato)
 * - `last_message_at IS NOT NULL`
 *
 * O caller reparte as linhas por `reason` após verificar `isWithinBusinessHours`.
 *
 * O `bucket` de idempotência é `ai_last_human_at` epoch para idle, ou
 * `last_message_at` epoch para o gatilho de horário.
 */
async function selectEligible(
  tx: DbTx,
  workspaceSettings: WorkspaceSettings,
  now: Date,
  idleMinutes: number,
): Promise<EligibleReengagementConversation[]> {
  const idleSec = idleMinutes * 60;

  // Verifica se o momento ATUAL está dentro do horário comercial (para o gatilho
  // de fora-de-horário: só reengaja se AGORA está dentro — a janela abriu).
  const withinHours = isWithinBusinessHours(workspaceSettings.settings, now);

  const rows = await tx.execute<EligibleRow>(sql`
    select
      c.id             as conversation_id,
      c.contact_id     as contact_id,
      c.channel_id     as channel_id,
      ch.provider      as provider,
      -- Idle: bucket = ai_last_human_at epoch; BH: bucket = last_message_at epoch.
      case
        when c.ai_last_human_at is not null
         and c.ai_last_human_at <= ${now} - make_interval(secs => ${idleSec})
          then extract(epoch from c.ai_last_human_at)::bigint
        else extract(epoch from c.last_message_at)::bigint
      end              as bucket_epoch,
      case
        when c.ai_last_human_at is not null
         and c.ai_last_human_at <= ${now} - make_interval(secs => ${idleSec})
          then 'idle'
        else 'business_hours'
      end              as reason
    from conversations c
    join channels ch on ch.id = c.channel_id
    where c.ai_mode = 'paused'
      and c.ai_paused_reason = 'human_takeover'
      and c.status in ('open', 'pending')
      and c.contact_id is not null
      and (
        -- Gatilho 1: idle expirou.
        (
          c.ai_last_human_at is not null
          and c.ai_last_human_at <= ${now} - make_interval(secs => ${idleSec})
        )
        -- Gatilho 2: fora-de-horário — só inclui se AGORA está dentro do horário.
        or (
          ${withinHours ? sql`true` : sql`false`}
          and c.last_message_from = 'contact'
          and c.last_message_at is not null
        )
      )
  `);

  const eligible: EligibleReengagementConversation[] = [];
  for (const row of rows) {
    if (!isChannelProvider(row.provider)) continue;
    const reason: ReengagementReason = row.reason === 'idle' ? 'idle' : 'business_hours';
    eligible.push({
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      channelId: row.channel_id,
      provider: row.provider,
      windowBucket: Number(row.bucket_epoch),
      reason,
    });
  }
  return eligible;
}

function isChannelProvider(value: string): value is ChannelProvider {
  return (CHANNEL_PROVIDERS as readonly string[]).includes(value);
}

// ─── Idempotência ─────────────────────────────────────────────────────────────

/** Chave de idempotência por (conversa, janela). */
export function reengagementMarkKey(conversationId: string, windowBucket: number): string {
  return `hm:reengagement:done:${conversationId}:${windowBucket}`;
}

/**
 * Grava a marca de idempotência. `SET NX EX` → `true` se esta instância é a
 * primeira a marcar esta (conversa, janela); `false` se outra já marcou.
 */
async function markReengagement(
  redis: ReengagementRedis,
  conversationId: string,
  windowBucket: number,
): Promise<boolean> {
  const key = reengagementMarkKey(conversationId, windowBucket);
  const ok = await redis.set(key, '1', 'EX', REENGAGEMENT_MARK_TTL_SEC, 'NX');
  return ok === 'OK';
}

// ─── Resume + publish ─────────────────────────────────────────────────────────

/**
 * Retoma a IA na conversa: atualiza `ai_mode='on'` e limpa o estado de pausa.
 * Executado dentro de `withWorkspace` (RLS), antes de publicar o envelope.
 *
 * Nota sobre a ordem: o runtime Python (S05) lê `ai_paused_reason` para injetar
 * a diretriz de handoff. Limpamos esses campos APÓS o worker ler — mas como o
 * envelope é publicado aqui e o worker o consome de forma assíncrona (RabbitMQ),
 * o UPDATE precede o consume. Limpamos imediatamente para garantir estado coerente.
 */
async function resumeAiMode(
  tx: DbTx,
  conversationId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(schema.conversations)
    .set({
      aiMode: 'on',
      aiPausedReason: null,
      aiPausedAt: null,
      aiPausedBy: null,
      aiResumeAt: null,
      updatedAt: now,
    })
    .where(eq(schema.conversations.id, conversationId));
}

/**
 * Publica `flow.run.requested` em `hm.q.flows` — envelope EXATO do worker de
 * agentes (F2-S11) e do followup.ts: `{ conversationId, contactId, channelId,
 * provider }`. `workspaceId` vai no Envelope. Sem `triggerExternalId` (proativo).
 */
function publishReengagementRun(
  channel: MqChannel,
  workspaceId: string,
  conv: EligibleReengagementConversation,
): void {
  const envelope = makeEnvelope(REENGAGEMENT_RUN_TYPE, workspaceId, {
    conversationId: conv.conversationId,
    contactId: conv.contactId,
    channelId: conv.channelId,
    provider: conv.provider,
  });
  channel.sendToQueue(
    REENGAGEMENT_FLOWS_QUEUE,
    Buffer.from(JSON.stringify(envelope)),
    { persistent: true, contentType: 'application/json' },
  );
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/** Dependências do tick (injetadas pelo bootstrap; mockáveis no teste). */
export interface ReengagementDeps {
  readonly redis: ReengagementRedis;
  readonly channel: MqChannel;
  readonly logger: Logger;
}

/** Opções do tick (instante injetável p/ teste). */
export interface ReengagementTickOptions {
  /** Instante de referência (default: agora). */
  readonly now?: Date;
  /** Limita a um único workspace (default: todos com conversas pausadas). Útil em teste. */
  readonly workspaceId?: string;
  /** Janela ociosa em minutos (default: env `REENGAGEMENT_IDLE_MINUTES` ou 60). */
  readonly idleMinutes?: number;
}

/** Resultado observável de um tick. */
export interface ReengagementTickResult {
  /** `true` se esta instância venceu o lock e rodou; `false` se pulou. */
  readonly ran: boolean;
  /** Workspaces visitados. */
  readonly workspaces: number;
  /** Conversas reengajadas (ai_mode=on + enfileiradas). */
  readonly enqueued: number;
  /** Elegíveis puladas por idempotência (já reengajadas nesta janela). */
  readonly skippedDuplicate: number;
}

/**
 * Processa um workspace: lê as configurações, seleciona elegíveis, aplica
 * idempotência, retoma `ai_mode` e publica o run.
 */
async function tickWorkspace(
  workspaceId: string,
  deps: ReengagementDeps,
  now: Date,
  idleMinutes: number,
): Promise<{ enqueued: number; skipped: number }> {
  return withWorkspace(workspaceId, async (tx) => {
    // Lê as configurações do workspace (business_hours) sob RLS.
    const [ws] = await tx
      .select({ settings: schema.workspaces.settings })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);

    const settings: Record<string, unknown> = ws?.settings ?? {};
    const workspaceSettings: WorkspaceSettings = { settings };

    const eligible = await selectEligible(tx, workspaceSettings, now, idleMinutes);

    let enqueued = 0;
    let skipped = 0;
    for (const conv of eligible) {
      // Idempotência: SET NX antes de qualquer side-effect.
      const fresh = await markReengagement(deps.redis, conv.conversationId, conv.windowBucket);
      if (!fresh) {
        skipped += 1;
        continue;
      }

      // Retoma ai_mode no DB.
      await resumeAiMode(tx, conv.conversationId, now);

      // Publica o run (o worker de agentes consome e roda o LangGraph).
      publishReengagementRun(deps.channel, workspaceId, conv);

      deps.logger.info('reengajamento: conversa reengajada', {
        conversationId: conv.conversationId,
        reason: conv.reason,
        workspaceId,
      });
      enqueued += 1;
    }
    return { enqueued, skipped };
  });
}

/**
 * Executa um tick do cron de reengajamento. Adquire o lock de scheduler (singleton);
 * se outra instância já o detém, retorna `ran:false`. Caso contrário, varre os
 * workspaces com conversas pausadas, reengaja os elegíveis e libera o lock.
 */
export async function runReengagementTick(
  deps: ReengagementDeps,
  options: ReengagementTickOptions = {},
): Promise<ReengagementTickResult> {
  const now = options.now ?? new Date();
  const idleMinutes = options.idleMinutes ?? idleMinutesFromEnv();

  const release = await acquireReengagementLock(
    deps.redis,
    REENGAGEMENT_LOCK_KEY,
    REENGAGEMENT_LOCK_TTL_MS,
  );
  if (release === null) {
    deps.logger.debug('reengajamento: tick pulado — lock detido por outra instância');
    return { ran: false, workspaces: 0, enqueued: 0, skippedDuplicate: 0 };
  }

  try {
    const targets =
      options.workspaceId !== undefined
        ? [options.workspaceId]
        : await workspacesWithPausedConversations();

    let enqueued = 0;
    let skippedDuplicate = 0;
    for (const workspaceId of targets) {
      try {
        const res = await tickWorkspace(workspaceId, deps, now, idleMinutes);
        enqueued += res.enqueued;
        skippedDuplicate += res.skipped;
      } catch (err: unknown) {
        // Um workspace falho não derruba os demais; o próximo tick recomputa.
        deps.logger.error('reengajamento: tick de workspace falhou', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result: ReengagementTickResult = {
      ran: true,
      workspaces: targets.length,
      enqueued,
      skippedDuplicate,
    };
    deps.logger.info('reengajamento: tick concluído', {
      workspaces: result.workspaces,
      enqueued: result.enqueued,
      skippedDuplicate: result.skippedDuplicate,
    });
    return result;
  } finally {
    await release();
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/** Lê o intervalo do tick do ambiente (`REENGAGEMENT_TICK_MS`, default 60 s). */
export function reengagementTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['REENGAGEMENT_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_REENGAGEMENT_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REENGAGEMENT_TICK_MS;
}

/** Handle do scheduler (parada limpa). */
export interface ReengagementSchedulerHandle {
  stop(): Promise<void>;
}

/** Opções do scheduler. */
export interface ReengagementSchedulerOptions {
  readonly intervalMs?: number;
}

/**
 * Inicia o scheduler de reengajamento: dispara `runReengagementTick` a cada
 * `intervalMs`. Idêntico ao padrão de `startFollowupScheduler`: reentrância
 * evitada por flag; erros logados sem derrubar o scheduler; primeiro tick
 * agendado (não imediato no boot). Retorna handle para parada limpa.
 */
export function startReengagementScheduler(
  deps: ReengagementDeps,
  options: ReengagementSchedulerOptions = {},
): ReengagementSchedulerHandle {
  const intervalMs = options.intervalMs ?? reengagementTickMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('reengajamento: tick anterior ainda em execução — disparo pulado');
      return;
    }
    running = true;
    void runReengagementTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('reengajamento: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  deps.logger.info('reengajamento scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('reengajamento scheduler parado');
      await Promise.resolve();
    },
  };
}
