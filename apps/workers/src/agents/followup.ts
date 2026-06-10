/**
 * Auto follow-up cron job (F2-S21, AGENTS_LANGGRAPH §4, ROADMAP F2-S21).
 *
 * Job agendado, **scheduler-singleton** e **idempotente**, que reengaja conversas
 * paradas: encontra conversas elegíveis (último contato sem resposta há ≥
 * `replyIfIdleSec`, com um agente `follow_up` ativo, dentro da janela do canal de
 * 24h) e enfileira um `flow.run.requested` em `hm.q.flows` — o MESMO envelope que
 * F1-S26 publica e que o worker de agentes (F2-S11, `worker.ts`) consome para
 * rodar o agente. O run em si é de F2-S11; aqui só se decide QUANDO disparar.
 *
 * ```
 * tick (a cada FOLLOWUP_TICK_MS):
 *   acquireSchedulerLock(redis, hm:lock:scheduler:followup)   ← só 1 instância roda
 *     descobre workspaces com conversas IA-ligadas              [getDb(), cross-tenant]
 *     por workspace, sob RLS (withWorkspace):
 *       SELECT conversas elegíveis (agente follow_up ativo +
 *         idle ≥ replyIfIdleSec + lastMessageFrom=contact +
 *         dentro da janela 24h do canal + status aberto)
 *       para cada conversa:
 *         markFollowup(redis, conv, windowBucket)  ← SET NX  (idempotência)
 *           se já marcada nesta janela → pula (não duplica)
 *         publish flow.run.requested → hm.q.flows
 *   release()
 * ```
 *
 * **Janela 24h (F1-S17, `apps/api/src/routes/conversations/window.ts`):** WhatsApp
 * e Instagram só aceitam free-form dentro de 24h a partir do último INBOUND do
 * contato; WAHA não impõe janela. Um follow-up FORA da janela seria bloqueado pelo
 * provider (WA) — então a seleção exige `lastMessageAt > now - 24h` para WA/IG.
 * `lastMessageFrom = 'contact'` garante que o último a falar foi o contato (a IA
 * já respondeu ou nunca respondeu); não reengajamos quem está esperando a gente.
 *
 * **Idempotência (DoD: re-run na mesma janela não duplica):** sem coluna dedicada
 * em `conversations`, a marca de "já segui esta conversa nesta janela" é uma chave
 * Redis `hm:followup:done:{conversationId}:{windowBucket}` gravada com `SET NX`. O
 * `windowBucket` é o epoch-segundo do `lastMessageAt` (a âncora da janela de
 * idle): enquanto o contato não mandar nova mensagem, `lastMessageAt` não muda →
 * mesmo bucket → o segundo tick vê a chave e pula. Uma nova mensagem do contato
 * move `lastMessageAt`, reabre a janela e permite um novo follow-up — exatamente o
 * comportamento desejado. TTL = 7 dias (cobre a janela estendida do IG e expira
 * sozinha; o pool Redis nunca cresce indefinidamente).
 *
 * **Scheduler singleton (ARCHITECTURE §1 — scheduler):** múltiplas instâncias do
 * processo workers competem pelo lock `hm:lock:scheduler:followup` (`SET NX PX`);
 * só a vencedora roda o tick. O lock tem TTL curto (cobre 1 tick) e é liberado por
 * Lua check-and-del (só o titular libera). Se a vencedora travar, o TTL expira e
 * outra assume no próximo tick — sem deadlock global.
 *
 * **In-process (ARCHITECTURE §4.2):** lê o DB direto via `@hm/db` + RLS; publica no
 * MQ via o `channel` AMQP injetado (mesmo transporte das deps dos demais workers).
 * Self-contained: o bootstrap só injeta `{ redis, channel, logger }` e chama
 * `startFollowupScheduler` (ver REPORT para a linha exata de wiring).
 */
import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { getDb, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { makeEnvelope, QUEUES, type MqHandle } from '@hm/shared/mq';
import { CHANNEL_PROVIDERS, type ChannelProvider } from '@hm/shared';
import type { Logger } from '@hm/logger';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila canônica de flows/agentes (`QUEUES.flows`, mesma do worker de F2-S11). */
export const FLOWS_QUEUE = QUEUES.flows;

/**
 * Tipo do envelope de disparo — espelha `AGENT_RUN_TYPE` de `worker.ts` /
 * `INBOUND_FLOW_TYPE` de F1-S26. O worker de agentes filtra por este `type`.
 */
export const FOLLOWUP_RUN_TYPE = 'flow.run.requested' as const;

/** Chave do lock de scheduler (singleton — só uma instância roda o tick). */
export const FOLLOWUP_LOCK_KEY = 'hm:lock:scheduler:followup' as const;

/**
 * Janela de 24h do canal (WA/IG), em milissegundos — espelha F1-S17. WAHA não
 * impõe janela (exemção tratada na própria query de elegibilidade).
 */
const CHANNEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** TTL da marca de idempotência (7d: cobre janela estendida IG e auto-expira). */
const FOLLOWUP_MARK_TTL_SEC = 7 * 24 * 60 * 60;

/** TTL do lock de scheduler: cobre um tick com folga (auto-expira se travar). */
export const FOLLOWUP_LOCK_TTL_MS = 30_000;

/** Período default entre ticks do scheduler (`FOLLOWUP_TICK_MS`). */
export const DEFAULT_FOLLOWUP_TICK_MS = 60_000;

// ─── Redis port (lock + idempotência) ─────────────────────────────────────────

/**
 * Subconjunto mínimo de `ioredis` que este job usa — declarado como porta para
 * (a) não acoplar `@hm/workers` ao pacote no código de domínio e (b) permitir um
 * mock direto nos testes. O bootstrap injeta uma instância real de `ioredis`
 * (que satisfaz esta forma). **`ioredis` precisa ser adicionado às deps de
 * `@hm/workers`** — hoje ausente (ver REPORT).
 */
export interface RedisLike {
  /** `SET key val NX PX ttl` → 'OK' se gravou, null se a chave já existia. */
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  /** Variante segundos (idempotência usa EX). */
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSec: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  /** Avalia um script Lua (unlock check-and-del do titular do lock). */
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Libera o lock só se ainda for do titular (token). Evita liberar o de outro. */
const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Função liberadora do lock de scheduler. Idempotente. */
export type ReleaseLock = () => Promise<void>;

/**
 * Adquire o lock de scheduler via `SET NX PX` com token único. Resolve com a
 * função de liberação se vencer, ou `null` se outra instância já o detém (este
 * tick é pulado nessa instância). O token garante que só o titular libera.
 */
export async function acquireSchedulerLock(
  redis: RedisLike,
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

// ─── Eligibility query (RLS, por workspace) ───────────────────────────────────

/**
 * Conversa elegível a follow-up resolvida dentro do tenant. `provider` decide se
 * a janela 24h se aplica (já filtrada na query para WA/IG; WAHA passa direto).
 */
export interface EligibleConversation {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channelId: string;
  readonly provider: ChannelProvider;
  /** Âncora da janela de idle (epoch-seg) → bucket de idempotência. */
  readonly windowBucket: number;
}

/** Linha crua do SELECT de elegibilidade (postgres-js). */
type EligibleRow = {
  conversation_id: string;
  contact_id: string;
  channel_id: string;
  provider: string;
  last_message_epoch: number;
} & Record<string, unknown>;

/**
 * Descobre os workspaces com conversas IA-ligadas (`ai_mode='on'`) — o universo
 * que pode ter follow-up. Cross-tenant (`getDb()` direto): é o passo que enumera
 * tenants, então roda fora de qualquer escopo RLS, espelhando o resolver do
 * inbound (`db-ports.ts`) e do roll-up de métricas (`metrics.ts`).
 */
async function workspacesWithAiConversations(): Promise<string[]> {
  const rows = await getDb().execute<{ workspace_id: string } & Record<string, unknown>>(sql`
    select distinct c.workspace_id
    from conversations c
    join agents a
      on a.workspace_id = c.workspace_id
     and a.status = 'active'
     and a.reply_if_idle_sec is not null
    where c.ai_mode = 'on'
  `);
  return [...rows].map((r) => r.workspace_id);
}

/**
 * Seleciona conversas elegíveis do tenant atual (RLS). Elegível =
 * - `ai_mode = 'on'` e `status` aberto (`open`/`pending`);
 * - o último a falar foi o contato (`last_message_from = 'contact'`) — a IA não
 *   está aguardando resposta nossa;
 * - existe um agente `follow_up` ATIVO do workspace habilitado para o canal
 *   (`status='active'`, `reply_if_idle_sec` não-nulo, e o canal em
 *   `enabled_channel_ids` ou a lista vazia = todos) — match por `agent_templates.key`;
 * - idle: `last_message_at <= now - reply_if_idle_sec`;
 * - dentro da janela 24h para WA/IG (`last_message_at > now - 24h`); WAHA isento.
 *
 * `last_message_at` é a âncora tanto do idle quanto da janela (o último evento da
 * conversa foi a mensagem do contato). Devolve o epoch-seg dela como
 * `window_bucket` de idempotência.
 */
async function selectEligible(
  tx: DbTx,
  now: Date,
): Promise<EligibleConversation[]> {
  const windowFloor = new Date(now.getTime() - CHANNEL_WINDOW_MS);
  const rows = await tx.execute<EligibleRow>(sql`
    select
      c.id            as conversation_id,
      c.contact_id    as contact_id,
      c.channel_id    as channel_id,
      ch.provider     as provider,
      extract(epoch from c.last_message_at)::bigint as last_message_epoch
    from conversations c
    join channels ch on ch.id = c.channel_id
    join agents a
      on a.workspace_id = c.workspace_id
     and a.status = 'active'
     and a.reply_if_idle_sec is not null
     and (cardinality(a.enabled_channel_ids) = 0 or c.channel_id = any(a.enabled_channel_ids))
    join agent_templates t
      on t.id = a.template_id
     and t.key = 'follow_up'
    where c.ai_mode = 'on'
      and c.status in ('open', 'pending')
      and c.contact_id is not null
      and c.last_message_from = 'contact'
      and c.last_message_at is not null
      and c.last_message_at <= ${now} - make_interval(secs => a.reply_if_idle_sec)
      and (
        ch.provider = 'waha'
        or c.last_message_at > ${windowFloor}
      )
  `);

  const eligible: EligibleConversation[] = [];
  for (const row of rows) {
    if (!isProvider(row.provider)) continue;
    eligible.push({
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      channelId: row.channel_id,
      provider: row.provider,
      windowBucket: Number(row.last_message_epoch),
    });
  }
  return eligible;
}

function isProvider(value: string): value is ChannelProvider {
  return (CHANNEL_PROVIDERS as readonly string[]).includes(value);
}

// ─── Idempotência + publish ───────────────────────────────────────────────────

/** Chave da marca de follow-up de uma conversa numa janela específica. */
export function followupMarkKey(conversationId: string, windowBucket: number): string {
  return `hm:followup:done:${conversationId}:${windowBucket}`;
}

/**
 * Marca a conversa como já seguida nesta janela. `SET NX` → `true` se gravou
 * (primeira vez nesta janela), `false` se já existia (outro tick/instância já
 * disparou) → o caller NÃO publica. Atômico: a corrida entre instâncias é
 * resolvida pelo NX.
 */
async function markFollowup(
  redis: RedisLike,
  conversationId: string,
  windowBucket: number,
): Promise<boolean> {
  const key = followupMarkKey(conversationId, windowBucket);
  const ok = await redis.set(key, '1', 'EX', FOLLOWUP_MARK_TTL_SEC, 'NX');
  return ok === 'OK';
}

/**
 * Publica o envelope `flow.run.requested` em `hm.q.flows` — shape EXATO de
 * F1-S26 / `agentRunTriggerSchema` de `worker.ts`:
 * `{ conversationId, contactId, channelId, provider }`. `workspaceId` vai no
 * Envelope, não no payload. Sem `triggerExternalId`: o follow-up não tem uma
 * mensagem inbound de gatilho (é proativo) — o campo é opcional no schema.
 */
function publishFollowupRun(
  channel: MqChannel,
  workspaceId: string,
  conv: EligibleConversation,
): void {
  const envelope = makeEnvelope(FOLLOWUP_RUN_TYPE, workspaceId, {
    conversationId: conv.conversationId,
    contactId: conv.contactId,
    channelId: conv.channelId,
    provider: conv.provider,
  });
  channel.sendToQueue(FLOWS_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/** Dependências do tick (injetadas pelo bootstrap; mockáveis no teste). */
export interface FollowupDeps {
  /** Cliente Redis (lock de scheduler + marca de idempotência). */
  readonly redis: RedisLike;
  /** Canal AMQP para publicar em `hm.q.flows` (transporte das deps dos workers). */
  readonly channel: MqChannel;
  readonly logger: Logger;
}

/** Opções do tick (instante de referência injetável p/ teste). */
export interface FollowupTickOptions {
  /** Instante de referência (default: agora). */
  readonly now?: Date;
  /** Limita a um único workspace (default: todos com conversas IA). Útil em teste. */
  readonly workspaceId?: string;
}

/** Resultado observável de um tick (log/teste). */
export interface FollowupTickResult {
  /** `true` se esta instância venceu o lock e rodou; `false` se pulou (outra roda). */
  readonly ran: boolean;
  /** Workspaces visitados sob RLS. */
  readonly workspaces: number;
  /** Conversas que receberam follow-up enfileirado neste tick. */
  readonly enqueued: number;
  /** Elegíveis puladas por já terem sido seguidas nesta janela (idempotência). */
  readonly skippedDuplicate: number;
}

/**
 * Processa um único workspace sob RLS: seleciona elegíveis, marca idempotência e
 * publica o run de cada uma. Retorna a contagem de enfileiradas + puladas.
 */
async function tickWorkspace(
  workspaceId: string,
  deps: FollowupDeps,
  now: Date,
): Promise<{ enqueued: number; skipped: number }> {
  const eligible = await withWorkspace(workspaceId, (tx) => selectEligible(tx, now));

  let enqueued = 0;
  let skipped = 0;
  for (const conv of eligible) {
    // Idempotência ANTES de publicar: o NX garante exatamente-um por (conv,
    // janela), mesmo com múltiplas instâncias ou ticks sobrepostos.
    const fresh = await markFollowup(deps.redis, conv.conversationId, conv.windowBucket);
    if (!fresh) {
      skipped += 1;
      continue;
    }
    publishFollowupRun(deps.channel, workspaceId, conv);
    enqueued += 1;
  }
  return { enqueued, skipped };
}

/**
 * Executa um tick do job de follow-up. Adquire o lock de scheduler (singleton):
 * se outra instância já o detém, retorna `ran:false` sem tocar no DB. Caso
 * contrário, varre os workspaces com conversas IA, enfileira follow-ups das
 * conversas elegíveis e libera o lock ao final (mesmo em erro).
 *
 * O scheduler chama isto a cada `FOLLOWUP_TICK_MS` (ver `startFollowupScheduler`).
 */
export async function runFollowupTick(
  deps: FollowupDeps,
  options: FollowupTickOptions = {},
): Promise<FollowupTickResult> {
  const now = options.now ?? new Date();

  const release = await acquireSchedulerLock(deps.redis, FOLLOWUP_LOCK_KEY, FOLLOWUP_LOCK_TTL_MS);
  if (release === null) {
    deps.logger.debug('followup: tick pulado — lock detido por outra instância');
    return { ran: false, workspaces: 0, enqueued: 0, skippedDuplicate: 0 };
  }

  try {
    const targets =
      options.workspaceId !== undefined
        ? [options.workspaceId]
        : await workspacesWithAiConversations();

    let enqueued = 0;
    let skippedDuplicate = 0;
    for (const workspaceId of targets) {
      try {
        const res = await tickWorkspace(workspaceId, deps, now);
        enqueued += res.enqueued;
        skippedDuplicate += res.skipped;
      } catch (err: unknown) {
        // Um workspace problemático não derruba os demais; o próximo tick
        // recomputa (idempotente).
        deps.logger.error('followup: tick de workspace falhou', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result: FollowupTickResult = {
      ran: true,
      workspaces: targets.length,
      enqueued,
      skippedDuplicate,
    };
    deps.logger.info('followup: tick concluído', {
      workspaces: result.workspaces,
      enqueued: result.enqueued,
      skippedDuplicate: result.skippedDuplicate,
    });
    return result;
  } finally {
    await release();
  }
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

/** Lê o intervalo do tick do ambiente (`FOLLOWUP_TICK_MS`, default 60s). */
export function followupTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['FOLLOWUP_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_FOLLOWUP_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FOLLOWUP_TICK_MS;
}

/** Handle do scheduler (parada limpa do interval). */
export interface FollowupSchedulerHandle {
  stop(): Promise<void>;
}

/** Opções do scheduler. */
export interface FollowupSchedulerOptions {
  /** Intervalo entre ticks (default: `FOLLOWUP_TICK_MS` do ambiente). */
  readonly intervalMs?: number;
}

/**
 * Inicia o scheduler do job de follow-up: dispara `runFollowupTick` a cada
 * `intervalMs`. Cada tick contende pelo lock Redis (singleton entre instâncias);
 * ticks sobrepostos são evitados por um flag de reentrância (um tick lento não
 * empilha em cima do próximo). Erros de um tick são logados e não derrubam o
 * scheduler — o próximo tick recomenta. Retorna um handle para parada limpa.
 *
 * NB: o primeiro tick é agendado (não roda imediatamente no boot) para não
 * competir com o restante do boot dos workers.
 */
export function startFollowupScheduler(
  deps: FollowupDeps,
  options: FollowupSchedulerOptions = {},
): FollowupSchedulerHandle {
  const intervalMs = options.intervalMs ?? followupTickMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      // Tick anterior ainda em voo — pula este disparo (evita reentrância).
      deps.logger.debug('followup: tick anterior ainda em execução — disparo pulado');
      return;
    }
    running = true;
    void runFollowupTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('followup: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  // Não impede o processo de encerrar enquanto ocioso.
  timer.unref?.();

  deps.logger.info('followup scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('followup scheduler parado');
      await Promise.resolve();
    },
  };
}
