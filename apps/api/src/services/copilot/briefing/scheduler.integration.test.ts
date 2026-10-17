/**
 * F73-S12 · agendador da manhã contra o Postgres e o Redis de dev: janela 06:30 do fuso do
 * workspace, lock entre réplicas, no máximo 1 push por membro por dia, opt-in, silêncio,
 * "já viu" e recuperação de falha de envio.
 *
 * Fuso do workspace = America/Chicago: em 2026-10-17 (CDT, UTC-5) o instante fixo
 * `BRIEFING_NOW` (13:00Z) é 08:00 locais, dentro da janela 06:30–10:30, e o mundo semeado
 * (relativo a ele) continua coerente.
 */
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, copilotBriefingsRepo, getDb, schema, withWorkspace } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { CopilotBriefingReadyPayload } from '@hm/shared';
import { loadConfig } from '../../../config';
import type { NotifiableEvent } from '../../notifications';
import { resolveCopilotPrincipal } from '../identity/principal';
import { acquireSweepLock } from '../proposals/sweeper';
import { getOrCreateToday } from './generate';
import {
  BRIEFING_DONE_PREFIX,
  BRIEFING_LOCK_PREFIX,
  createBriefingSchedulerDeps,
  runBriefingTick,
  type BriefingSchedulerDeps,
  type TickResult,
} from './scheduler';
import { BRIEFING_DATE, BRIEFING_NOW, seedBriefingWorld, type BriefingWorld } from './test-fixtures';

const HOUR = 3_600_000;
const DAY = 86_400_000;

let redis: Redis;
const worlds: BriefingWorld[] = [];

beforeAll(() => {
  redis = new Redis(loadConfig().redisUrl, { maxRetriesPerRequest: 1 });
});

afterAll(async () => {
  for (const w of worlds) {
    await redis.del(
      `${BRIEFING_DONE_PREFIX}:${w.workspaceId}:${BRIEFING_DATE}`,
      `${BRIEFING_LOCK_PREFIX}:${w.workspaceId}:${BRIEFING_DATE}`,
    );
    await w.cleanup();
  }
  await redis.quit();
  await closeDb();
});

interface Recorder {
  readonly deps: BriefingSchedulerDeps;
  readonly notified: NotifiableEvent[];
  readonly emitted: { memberId: string; payload: CopilotBriefingReadyPayload }[];
  setNow(at: Date): void;
  failNextNotify(): void;
}

function recorder(): Recorder {
  let now = BRIEFING_NOW;
  let failNext = false;
  const notified: NotifiableEvent[] = [];
  const emitted: { memberId: string; payload: CopilotBriefingReadyPayload }[] = [];
  const deps = createBriefingSchedulerDeps({
    redis,
    now: () => now,
    logger: createLogger('error', { svc: 'test' }),
    notify: async (event) => {
      if (failNext) {
        failNext = false;
        throw new Error('push indisponível');
      }
      notified.push(event);
      return { entreguePor: 'push', suppressedBy: null };
    },
    emit: async ({ memberId, payload }) => {
      emitted.push({ memberId, payload });
    },
  });
  return {
    deps,
    notified,
    emitted,
    setNow: (at) => {
      now = at;
    },
    failNextNotify: () => {
      failNext = true;
    },
  };
}

async function world(): Promise<BriefingWorld> {
  const w = await seedBriefingWorld({ label: 'BriefingSched' });
  worlds.push(w);
  await getDb()
    .update(schema.workspaces)
    .set({ timezone: 'America/Chicago' })
    .where(eq(schema.workspaces.id, w.workspaceId));
  return w;
}

const OPT_IN = { byEvent: { copilot_briefing: ['push'] } } as const;

async function setMember(
  memberId: string,
  patch: {
    lastSeenAt?: Date | null;
    optIn?: boolean;
    quiet?: { startHour: number; endHour: number };
    timezone?: string;
  },
): Promise<void> {
  // O tipo da coluna é o formato antigo (3 interruptores); `byEvent`/`quietHours` são o refinamento.
  const prefs = {
    ...(patch.optIn ? OPT_IN : {}),
    ...(patch.quiet ? { quietHours: patch.quiet } : {}),
  } as unknown as typeof schema.members.$inferSelect.notificationPrefs;
  await getDb()
    .update(schema.members)
    .set({
      ...(patch.lastSeenAt !== undefined ? { lastSeenAt: patch.lastSeenAt } : {}),
      notificationPrefs: prefs,
      ...(patch.timezone ? { timezone: patch.timezone } : {}),
    })
    .where(eq(schema.members.id, memberId));
}

async function briefingRows(w: BriefingWorld) {
  return getDb()
    .select()
    .from(schema.copilotBriefings)
    .where(eq(schema.copilotBriefings.workspaceId, w.workspaceId));
}

const only = (w: BriefingWorld) => ({ workspaceIds: [w.workspaceId] });
const sum = (ticks: readonly TickResult[], key: keyof TickResult): number =>
  ticks.reduce((n, t) => n + t[key], 0);

describe('agendador do briefing', () => {
  it('2 ticks simultâneos: 1 processa, o outro respeita o lock; 1 push só para quem optou', async () => {
    const w = await world();
    const rec = recorder();
    const recent = new Date(BRIEFING_NOW.getTime() - 1 * DAY);
    await setMember(w.member('OWNER'), { lastSeenAt: recent, optIn: true });
    await setMember(w.member('ADMIN'), { lastSeenAt: recent }); // ativo, não optou
    await setMember(w.member('READONLY'), { lastSeenAt: recent }); // ativo, não optou
    await setMember(w.member('AGENT'), { lastSeenAt: recent, optIn: true }); // optou, mas nunca abre sozinho
    await setMember(w.member('SUPERVISOR'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - 30 * DAY), // inativo há 30 dias
      optIn: true,
    });
    await setMember(w.agentB, { lastSeenAt: null, optIn: true }); // nunca entrou
    await withWorkspace(w.workspaceId, (tx) =>
      tx
        .insert(schema.copilotMemberPrefs)
        .values({ workspaceId: w.workspaceId, memberId: w.member('AGENT'), autoOpen: 'never' }),
    );

    const ticks = await Promise.all([
      runBriefingTick(rec.deps, only(w)),
      runBriefingTick(rec.deps, only(w)),
    ]);
    expect(sum(ticks, 'due')).toBe(2);
    expect(sum(ticks, 'processed')).toBe(1);
    expect(sum(ticks, 'locked') + sum(ticks, 'alreadyDone')).toBe(1);
    expect(sum(ticks, 'errors')).toBe(0);

    // Briefing só para os elegíveis: OWNER, ADMIN, READONLY.
    const rows = await briefingRows(w);
    expect(rows.map((r) => r.memberId).sort()).toEqual(
      [w.member('OWNER'), w.member('ADMIN'), w.member('READONLY')].sort(),
    );
    expect(rows.every((r) => r.forDate === BRIEFING_DATE)).toBe(true);

    // Push: só o OWNER optou e tem itens; uma vez.
    expect(rec.notified).toHaveLength(1);
    expect(rec.notified[0]).toMatchObject({
      workspaceId: w.workspaceId,
      memberId: w.member('OWNER'),
      evento: 'copilot_briefing',
      eventKey: `copilot_briefing:${BRIEFING_DATE}`,
      titulo: 'Briefing do dia: 3 itens',
      url: '/hoje',
    });
    const ownerRow = rows.find((r) => r.memberId === w.member('OWNER'));
    expect(ownerRow?.pushSentAt).not.toBeNull();
    for (const r of rows.filter((x) => x.memberId !== w.member('OWNER'))) {
      expect(r.pushSentAt).toBeNull();
    }

    // `copilot:briefing_ready` para quem teve o briefing gerado, com a contagem real.
    expect(rec.emitted.map((e) => e.memberId).sort()).toEqual(
      [w.member('OWNER'), w.member('ADMIN'), w.member('READONLY')].sort(),
    );
    for (const e of rec.emitted) {
      const row = rows.find((r) => r.memberId === e.memberId);
      expect(e.payload).toEqual({ for_date: BRIEFING_DATE, item_count: row?.items.length ?? -1 });
    }

    // 3º tick: o workspace já está concluído hoje.
    const third = await runBriefingTick(rec.deps, only(w));
    expect(third.alreadyDone).toBe(1);
    expect(third.processed).toBe(0);
    expect(rec.notified).toHaveLength(1);
  });

  it('lock de outra réplica ocupado: este tick não toca no workspace', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    const release = await acquireSweepLock(
      redis,
      `${BRIEFING_LOCK_PREFIX}:${w.workspaceId}:${BRIEFING_DATE}`,
      60_000,
    );
    expect(release).not.toBeNull();
    try {
      const t = await runBriefingTick(rec.deps, only(w));
      expect(t.locked).toBe(1);
      expect(t.processed).toBe(0);
      expect(await briefingRows(w)).toHaveLength(0);
      expect(rec.notified).toHaveLength(0);
    } finally {
      await release?.();
    }
    // Liberado o lock, o próximo tick processa normalmente.
    const next = await runBriefingTick(rec.deps, only(w));
    expect(next.processed).toBe(1);
    expect(next.pushed).toBe(1);
  });

  it('lock e marca perdidos (réplica reiniciada): reprocessa, mas NUNCA manda o 2º push do dia', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    const first = await runBriefingTick(rec.deps, only(w));
    expect(first.pushed).toBe(1);
    await redis.del(
      `${BRIEFING_DONE_PREFIX}:${w.workspaceId}:${BRIEFING_DATE}`,
      `${BRIEFING_LOCK_PREFIX}:${w.workspaceId}:${BRIEFING_DATE}`,
    );
    const again = await runBriefingTick(rec.deps, only(w));
    expect(again.processed).toBe(1);
    expect(again.generated).toBe(0);
    expect(again.pushed).toBe(0);
    expect(rec.notified).toHaveLength(1);
    expect((await briefingRows(w)).filter((r) => r.memberId === w.member('OWNER'))).toHaveLength(1);
  });

  it('fora da janela 06:30–10:30 locais ou com o Copiloto desligado: nada acontece', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    // 06:00 locais: ainda cedo. 11:00 locais: a janela de recuperação já fechou.
    for (const at of [
      new Date(BRIEFING_NOW.getTime() - 2 * HOUR),
      new Date(BRIEFING_NOW.getTime() + 3 * HOUR),
    ]) {
      rec.setNow(at);
      const t = await runBriefingTick(rec.deps, only(w));
      expect(t.due).toBe(0);
    }
    expect(await briefingRows(w)).toHaveLength(0);

    // 10:30 em ponto: a janela fechou (limite superior exclusivo).
    rec.setNow(new Date(BRIEFING_NOW.getTime() + 150 * 60_000));
    expect((await runBriefingTick(rec.deps, only(w))).due).toBe(0);

    // 06:30 em ponto já vale (limite inferior inclusivo).
    rec.setNow(new Date(BRIEFING_NOW.getTime() - 90 * 60_000));
    expect((await runBriefingTick(rec.deps, only(w))).due).toBe(1);

    const off = await world();
    await withWorkspace(off.workspaceId, (tx) =>
      tx.insert(schema.copilotSettings).values({ workspaceId: off.workspaceId, enabled: false }),
    );
    const rec2 = recorder();
    expect((await runBriefingTick(rec2.deps, only(off))).due).toBe(0);
  });

  it('falha ao enviar o push devolve o claim: o próximo tick tenta de novo e envia uma vez', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    rec.failNextNotify();
    const first = await runBriefingTick(rec.deps, only(w));
    expect(first.errors).toBe(1);
    expect(first.pushed).toBe(0);
    let row = (await briefingRows(w)).find((r) => r.memberId === w.member('OWNER'));
    expect(row?.pushSentAt).toBeNull();

    const second = await runBriefingTick(rec.deps, only(w));
    expect(second.errors).toBe(0);
    expect(second.pushed).toBe(1);
    expect(second.generated).toBe(0);
    row = (await briefingRows(w)).find((r) => r.memberId === w.member('OWNER'));
    expect(row?.pushSentAt).not.toBeNull();
    expect(rec.notified).toHaveLength(1);
    // Só o primeiro tick avisou o socket (o briefing já existia no segundo).
    expect(rec.emitted.filter((e) => e.memberId === w.member('OWNER'))).toHaveLength(1);
  });

  it('horário de silêncio do membro: adia o push (sem consumir o claim) até o silêncio acabar', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
      quiet: { startHour: 22, endHour: 9 },
      timezone: 'America/Chicago',
    });
    // 08:00 locais: dentro do silêncio 22h–9h.
    const quiet = await runBriefingTick(rec.deps, only(w));
    expect(quiet.deferred).toBe(1);
    expect(quiet.pushed).toBe(0);
    expect(rec.notified).toHaveLength(0);
    let row = (await briefingRows(w)).find((r) => r.memberId === w.member('OWNER'));
    expect(row?.pushSentAt).toBeNull();
    // O briefing já existe (o balão funciona); só o push espera.
    expect(row?.status).toBe('ready');

    // 09:30 locais: silêncio acabou e a janela (até 10:30) segue aberta.
    rec.setNow(new Date(BRIEFING_NOW.getTime() + 90 * 60_000));
    const after = await runBriefingTick(rec.deps, only(w));
    expect(after.pushed).toBe(1);
    expect(rec.notified).toHaveLength(1);
    row = (await briefingRows(w)).find((r) => r.memberId === w.member('OWNER'));
    expect(row?.pushSentAt).not.toBeNull();
  });

  it('quem já abriu o briefing do dia não recebe push do que já viu', async () => {
    const w = await world();
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    await withWorkspace(w.workspaceId, async (tx) => {
      const principal = await resolveCopilotPrincipal(tx, {
        workspaceId: w.workspaceId,
        memberId: w.member('OWNER'),
        now: BRIEFING_NOW,
      });
      if (!principal) throw new Error('principal');
      await getOrCreateToday(tx, principal, { now: BRIEFING_NOW });
      await copilotBriefingsRepo.markSeen(tx, w.member('OWNER'), BRIEFING_DATE);
    });
    const t = await runBriefingTick(rec.deps, only(w));
    expect(t.pushed).toBe(0);
    expect(rec.notified).toHaveLength(0);
  });

  it('cascata REAL de notificação: só quem optou entra, com a chave do dia (push-only; sem aparelho = suprimido)', async () => {
    const w = await world();
    const rec = recorder();
    const real = createBriefingSchedulerDeps({
      redis,
      now: () => BRIEFING_NOW,
      logger: createLogger('error', { svc: 'test' }),
      emit: async () => undefined,
    });
    const recent = new Date(BRIEFING_NOW.getTime() - DAY);
    await setMember(w.member('OWNER'), { lastSeenAt: recent, optIn: true });
    await setMember(w.member('ADMIN'), { lastSeenAt: recent });
    const t = await runBriefingTick(real, only(w));
    expect(t.errors).toBe(0);
    expect(rec.notified).toHaveLength(0);
    const deliveries = await getDb()
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.workspaceId, w.workspaceId));
    expect(deliveries.map((d) => d.memberId)).toEqual([w.member('OWNER')]);
    expect(deliveries[0]).toMatchObject({
      eventType: 'copilot_briefing',
      eventKey: `copilot_briefing:${BRIEFING_DATE}`,
      channel: 'push',
    });
  });

  it('workspace sem nada para mostrar: briefing `empty` gerado, sem push', async () => {
    const w = await seedBriefingWorld({ label: 'BriefingSchedEmpty', empty: true });
    worlds.push(w);
    await getDb()
      .update(schema.workspaces)
      .set({ timezone: 'America/Chicago' })
      .where(eq(schema.workspaces.id, w.workspaceId));
    const rec = recorder();
    await setMember(w.member('OWNER'), {
      lastSeenAt: new Date(BRIEFING_NOW.getTime() - DAY),
      optIn: true,
    });
    const t = await runBriefingTick(rec.deps, only(w));
    expect(t.pushed).toBe(0);
    const row = (await briefingRows(w)).find((r) => r.memberId === w.member('OWNER'));
    expect(row?.status).toBe('empty');
    expect(rec.notified).toHaveLength(0);
  });
});
