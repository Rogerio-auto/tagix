/**
 * Agendador do briefing da manhã (COPILOTO.md §5.5, §5.6, §7.1), no processo HTTP da API.
 *
 * A cada tick (5 min), para cada workspace cujo relógio LOCAL está entre 06:30 e 10:30
 * (`BRIEFING_SEND_LOCAL_MINUTES` + janela de recuperação, caso a API tenha ficado fora do ar
 * às 06:30):
 *
 *   1. lock Redis por (workspace, data local) — `SET NX PX` com token, o mesmo padrão do
 *      varredor de propostas (`acquireSweepLock`). Duas réplicas nunca processam o mesmo
 *      workspace/dia ao mesmo tempo;
 *   2. membros ativos nos últimos 14 dias, com o Copiloto liberado para o papel e `auto_open`
 *      efetivo ≠ 'never', em lotes de 50 (keyset por id);
 *   3. por membro, em transação própria: gera o briefing do dia (idempotente: se já existe,
 *      não regera), reivindica o push (`push_sent_at IS NULL` → atômico), e DEPOIS do commit
 *      avisa (`copilot_briefing`, só push, opt-in por pessoa) e emite `copilot:briefing_ready`;
 *   4. com o workspace inteiro processado sem pendência, grava a marca `done` (36 h) e os
 *      próximos ticks do dia nem consultam os membros.
 *
 * Garantias:
 * - no máximo UM push por membro por dia: o claim em `push_sent_at` é atômico e vale mesmo se
 *   o lock expirar no meio. O custo é aceito de propósito: se o processo morrer entre o commit
 *   do claim e o envio, o push daquele dia se perde (o briefing continua lá ao abrir o app).
 *   Se o envio LANÇAR, o claim é devolvido e o próximo tick tenta de novo (a cascata deduplica
 *   por `eventKey`, então um retry depois de um envio parcial não duplica);
 * - respeita o opt-in: sem `copilot_briefing: ['push']` em `notification_prefs.byEvent`, nada
 *   sai (o briefing é gerado do mesmo jeito, para o balão);
 * - horário de silêncio do membro: o push é ADIADO (não consumido) até o silêncio acabar,
 *   dentro da mesma janela;
 * - quem já abriu o briefing não recebe push de algo que já viu.
 */
import Redis from 'ioredis';
import { and, asc, eq, gt, gte } from 'drizzle-orm';
import { copilotBriefingsRepo, getDb, schema, withWorkspace, type DbTx } from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import {
  channelsFor,
  copilotAccessFor,
  inQuietHours,
  type CopilotBriefingReadyPayload,
  type NotificationPrefs,
  type Role,
} from '@hm/shared';
import { loadConfig } from '../../../config';
import { isSubscriptionInactive } from '../../../middlewares/subscription-guard';
import { horaLocalDe, notifyEvent, type NotifiableEvent } from '../../notifications';
import { resolveCopilotPrincipal, sanitizeCapabilityMatrix } from '../identity/principal';
import { acquireSweepLock, type SweepRedis } from '../proposals/sweeper';
import { relayBriefingReady, type BriefingReadyEmitter } from './emit';
import { getOrCreateToday, localDateOf, localMinutesOf } from './generate';
import { makeTextKit, pushTitle } from './texts';
import {
  BRIEFING_ACTIVE_WINDOW_DAYS,
  BRIEFING_CATCHUP_MINUTES,
  BRIEFING_MEMBER_BATCH,
  BRIEFING_SEND_LOCAL_MINUTES,
  BRIEFING_TICK_INTERVAL_MS,
} from './types';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';

export const BRIEFING_LOCK_PREFIX = 'hm:lock:scheduler:copilot-briefing' as const;
export const BRIEFING_DONE_PREFIX = 'hm:copilot-briefing:done' as const;
const BRIEFING_LOCK_TTL_MS = 10 * 60_000;
const BRIEFING_DONE_TTL_MS = 36 * 60 * 60_000;
const BRIEFING_INITIAL_DELAY_MS = 10_000;
const DAY_MS = 86_400_000;

/** O mínimo de Redis do agendador (ioredis real ou fake de teste). */
export interface BriefingRedis extends SweepRedis {
  get(key: string): Promise<string | null>;
}

export type BriefingNotifier = (event: NotifiableEvent) => Promise<unknown>;

export interface BriefingSchedulerDeps {
  readonly now: () => Date;
  readonly redis: BriefingRedis;
  readonly emit: BriefingReadyEmitter;
  readonly notify: BriefingNotifier;
  readonly logger: Logger;
}

export interface TickResult {
  /** Workspaces dentro da janela da manhã neste tick. */
  readonly due: number;
  /** Outra réplica estava processando (lock ocupado). */
  readonly locked: number;
  /** Já concluídos hoje (marca `done`). */
  readonly alreadyDone: number;
  /** Processados por este tick. */
  readonly processed: number;
  readonly members: number;
  /** Briefings gerados por este tick. */
  readonly generated: number;
  /** Pushes entregues à cascata de notificação. */
  readonly pushed: number;
  /** Pushes adiados por horário de silêncio. */
  readonly deferred: number;
  readonly errors: number;
}

interface MutableTick {
  due: number;
  locked: number;
  alreadyDone: number;
  processed: number;
  members: number;
  generated: number;
  pushed: number;
  deferred: number;
  errors: number;
}

interface DueWorkspace {
  readonly id: string;
  readonly timezone: string;
  readonly defaultAutoOpen: string;
  readonly capabilityMatrix: unknown;
}

/**
 * Workspaces dentro da janela da manhã agora, com o Copiloto ligado e a assinatura ativa.
 * Roda no papel owner, entre workspaces (uma consulta por tick).
 */
async function listDueWorkspaces(
  now: Date,
  only: readonly string[] | undefined,
): Promise<DueWorkspace[]> {
  const w = schema.workspaces;
  const cs = schema.copilotSettings;
  const rows = await getDb()
    .select({
      id: w.id,
      timezone: w.timezone,
      status: w.subscriptionStatus,
      trialEndsAt: w.trialEndsAt,
      enabled: cs.enabled,
      defaultAutoOpen: cs.defaultAutoOpen,
      capabilityMatrix: cs.capabilityMatrix,
    })
    .from(w)
    .leftJoin(cs, eq(cs.workspaceId, w.id));
  const filter = only ? new Set(only) : null;
  return rows.flatMap((r): DueWorkspace[] => {
    if (filter && !filter.has(r.id)) return [];
    if (r.enabled === false) return [];
    if (isSubscriptionInactive(r.status, r.trialEndsAt, now)) return [];
    const minutes = localMinutesOf(now, r.timezone);
    if (
      minutes < BRIEFING_SEND_LOCAL_MINUTES ||
      minutes >= BRIEFING_SEND_LOCAL_MINUTES + BRIEFING_CATCHUP_MINUTES
    ) {
      return [];
    }
    return [
      {
        id: r.id,
        timezone: r.timezone,
        defaultAutoOpen: r.defaultAutoOpen ?? 'daily',
        capabilityMatrix: r.capabilityMatrix ?? {},
      },
    ];
  });
}

interface EligibleMember {
  readonly id: string;
  readonly role: Role;
  readonly prefs: NotificationPrefs;
  readonly timezone: string | null;
}

const ROLE_SET: ReadonlySet<string> = new Set(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY']);

/** Um lote de membros elegíveis depois de `cursor` (keyset por id). */
async function listMemberBatch(
  tx: DbTx,
  ws: DueWorkspace,
  now: Date,
  cursor: string | null,
): Promise<{ scanned: number; lastId: string | null; eligible: EligibleMember[] }> {
  const m = schema.members;
  const p = schema.copilotMemberPrefs;
  const since = new Date(now.getTime() - BRIEFING_ACTIVE_WINDOW_DAYS * DAY_MS);
  const rows = await tx
    .select({
      id: m.id,
      role: m.role,
      prefs: m.notificationPrefs,
      timezone: m.timezone,
      autoOpen: p.autoOpen,
    })
    .from(m)
    .leftJoin(p, and(eq(p.workspaceId, m.workspaceId), eq(p.memberId, m.id)))
    .where(
      and(
        eq(m.workspaceId, ws.id),
        eq(m.status, 'active'),
        gte(m.lastSeenAt, since),
        ...(cursor ? [gt(m.id, cursor)] : []),
      ),
    )
    .orderBy(asc(m.id))
    .limit(BRIEFING_MEMBER_BATCH);
  const matrix = sanitizeCapabilityMatrix(ws.capabilityMatrix);
  const eligible = rows.flatMap((r): EligibleMember[] => {
    if (!ROLE_SET.has(r.role)) return [];
    const role = r.role as Role;
    if (!copilotAccessFor(role, matrix).allowed) return [];
    if ((r.autoOpen ?? ws.defaultAutoOpen) === 'never') return [];
    return [{ id: r.id, role, prefs: r.prefs as NotificationPrefs, timezone: r.timezone }];
  });
  return { scanned: rows.length, lastId: rows[rows.length - 1]?.id ?? null, eligible };
}

/** Devolve o claim do push (o envio lançou): o próximo tick tenta de novo. */
async function releasePushClaim(workspaceId: string, briefingId: string): Promise<void> {
  await withWorkspace(workspaceId, (tx) =>
    tx
      .update(schema.copilotBriefings)
      .set({ pushSentAt: null })
      .where(eq(schema.copilotBriefings.id, briefingId)),
  );
}

async function processMember(
  deps: BriefingSchedulerDeps,
  ws: DueWorkspace,
  member: EligibleMember,
  now: Date,
  tick: MutableTick,
): Promise<void> {
  const prepared = await withWorkspace(ws.id, async (tx) => {
    const principal = await resolveCopilotPrincipal(tx, {
      workspaceId: ws.id,
      memberId: member.id,
      now,
    });
    if (!principal || principal.memberStatus !== 'active') return null;
    const today = await getOrCreateToday(tx, principal, { now, revalidate: false });
    const itemCount = today.briefing.items.length;
    const optedIn = channelsFor(member.prefs, 'copilot_briefing').includes('push');
    const wantsPush =
      optedIn &&
      itemCount > 0 &&
      today.row.status === 'ready' &&
      today.row.seenAt === null &&
      today.row.pushSentAt === null;
    // Silêncio do membro: adia sem consumir o claim (o próximo tick, ainda na janela, tenta).
    const quiet =
      wantsPush &&
      inQuietHours(horaLocalDe(now, member.timezone), member.prefs.quietHours) === true;
    let claimed = false;
    if (wantsPush && !quiet) {
      claimed = await copilotBriefingsRepo.markPushSent(tx, today.row.id);
    }
    const fmt = await loadWorkspaceFormat(tx, ws.id);
    return {
      created: today.created,
      forDate: today.briefing.for_date,
      itemCount,
      briefingId: today.row.id,
      claimed,
      quiet,
      kit: makeTextKit(fmt),
    };
  });
  if (!prepared) return;
  tick.members += 1;
  if (prepared.created) tick.generated += 1;
  if (prepared.quiet) tick.deferred += 1;

  if (prepared.created) {
    const payload: CopilotBriefingReadyPayload = {
      for_date: prepared.forDate,
      item_count: prepared.itemCount,
    };
    try {
      await deps.emit({ workspaceId: ws.id, memberId: member.id, payload });
    } catch (err) {
      deps.logger.warn('copilot-briefing: falha ao emitir briefing_ready', {
        workspaceId: ws.id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
  }

  if (prepared.claimed) {
    try {
      await deps.notify({
        workspaceId: ws.id,
        memberId: member.id,
        evento: 'copilot_briefing',
        eventKey: `copilot_briefing:${prepared.forDate}`,
        titulo: pushTitle(prepared.kit, prepared.itemCount),
        origem: 'Copiloto',
        url: '/hoje',
      });
      tick.pushed += 1;
    } catch (err) {
      tick.errors += 1;
      deps.logger.error('copilot-briefing: falha ao enviar o push', {
        ref: 'hm_copilot_briefing_push',
        workspaceId: ws.id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      await releasePushClaim(ws.id, prepared.briefingId).catch(() => undefined);
    }
  }
}

/** Processa o workspace em lotes de 50. `true` = nada pendente (pode marcar `done`). */
async function processWorkspace(
  deps: BriefingSchedulerDeps,
  ws: DueWorkspace,
  now: Date,
  tick: MutableTick,
): Promise<boolean> {
  let cursor: string | null = null;
  const deferredBefore = tick.deferred;
  const errorsBefore = tick.errors;
  for (;;) {
    const batch = await withWorkspace(ws.id, (tx) => listMemberBatch(tx, ws, now, cursor));
    for (const member of batch.eligible) {
      try {
        await processMember(deps, ws, member, now, tick);
      } catch (err) {
        tick.errors += 1;
        deps.logger.error('copilot-briefing: falha ao processar membro', {
          ref: 'hm_copilot_briefing_member',
          workspaceId: ws.id,
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
    }
    if (batch.scanned < BRIEFING_MEMBER_BATCH || batch.lastId === null) break;
    cursor = batch.lastId;
  }
  return tick.deferred === deferredBefore && tick.errors === errorsBefore;
}

export interface TickOptions {
  /** Restringe a estes workspaces (testes). */
  readonly workspaceIds?: readonly string[];
}

/** Uma passada do agendador. */
export async function runBriefingTick(
  deps: BriefingSchedulerDeps,
  options: TickOptions = {},
): Promise<TickResult> {
  const now = deps.now();
  const tick: MutableTick = {
    due: 0,
    locked: 0,
    alreadyDone: 0,
    processed: 0,
    members: 0,
    generated: 0,
    pushed: 0,
    deferred: 0,
    errors: 0,
  };
  const due = await listDueWorkspaces(now, options.workspaceIds);
  tick.due = due.length;

  for (const ws of due) {
    const forDate = localDateOf(now, ws.timezone);
    const doneKey = `${BRIEFING_DONE_PREFIX}:${ws.id}:${forDate}`;
    if ((await deps.redis.get(doneKey)) !== null) {
      tick.alreadyDone += 1;
      continue;
    }
    const release = await acquireSweepLock(
      deps.redis,
      `${BRIEFING_LOCK_PREFIX}:${ws.id}:${forDate}`,
      BRIEFING_LOCK_TTL_MS,
    );
    if (!release) {
      tick.locked += 1;
      continue;
    }
    try {
      // Outra réplica pode ter concluído entre a primeira leitura e o lock.
      if ((await deps.redis.get(doneKey)) !== null) {
        tick.alreadyDone += 1;
        continue;
      }
      const clean = await processWorkspace(deps, ws, now, tick);
      tick.processed += 1;
      if (clean) await deps.redis.set(doneKey, '1', 'PX', BRIEFING_DONE_TTL_MS, 'NX');
    } catch (err) {
      tick.errors += 1;
      deps.logger.error('copilot-briefing: falha ao processar o workspace', {
        ref: 'hm_copilot_briefing_workspace',
        workspaceId: ws.id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    } finally {
      await release().catch(() => undefined);
    }
  }
  return tick;
}

export function createBriefingSchedulerDeps(
  overrides: Partial<BriefingSchedulerDeps> & { readonly redis: BriefingRedis },
): BriefingSchedulerDeps {
  return {
    now: () => new Date(),
    emit: relayBriefingReady,
    notify: notifyEvent,
    logger: createLogger('info', { svc: '@hm/api', component: 'copilot-briefing' }),
    ...overrides,
  };
}

export interface BriefingScheduler {
  /** Para o timer e espera a passada em andamento. */
  stop(): Promise<void>;
}

/**
 * Liga o agendador. Timers `unref` (não seguram o processo vivo); `stop()` no shutdown.
 * Sem `redis`, abre um cliente próprio (fechado no `stop`).
 */
export function startBriefingScheduler(
  options: {
    readonly intervalMs?: number;
    readonly redis?: BriefingRedis;
    readonly deps?: Partial<BriefingSchedulerDeps>;
  } = {},
): BriefingScheduler {
  const ownRedis = options.redis
    ? null
    : new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const redis: BriefingRedis = options.redis ?? (ownRedis as Redis);
  const deps = createBriefingSchedulerDeps({ ...options.deps, redis });
  let running: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running) return;
    running = runBriefingTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('copilot-briefing: passada falhou', {
          ref: 'hm_copilot_briefing_tick',
          errorName: err instanceof Error ? err.name : typeof err,
        });
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, options.intervalMs ?? BRIEFING_TICK_INTERVAL_MS);
  timer.unref();
  // Reinício às 06:40 não espera 5 min para recuperar a manhã.
  const first = setTimeout(tick, BRIEFING_INITIAL_DELAY_MS);
  first.unref();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
      if (running) await running;
      if (ownRedis) await ownRedis.quit().catch(() => undefined);
    },
  };
}
