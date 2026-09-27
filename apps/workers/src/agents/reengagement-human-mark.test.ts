/**
 * F70-S23 (nota do M2) — a marca "IA ligada por um humano" contra a retomada automática,
 * no Postgres dev (trigger da 0088 com a função da 0089, UPDATE real do reengajamento).
 *
 * Regra (fail-closed): a retomada de uma pausa `human_takeover` preserva a marca humana
 * que era válida ANTES da pausa; qualquer outro `on` automático a invalida.
 *
 *  - ligada por humano → atendente assume (pausa) → reengajamento retoma: a conversa
 *    volta a `on`, `ai_auto_enabled_at` fica intacto e o worker pode responder;
 *  - ligada por humano → IA `off` → `on` automático: o trigger carimba e o worker não
 *    responde;
 *  - marca já vencida por um `on` automático antes da pausa: não retoma;
 *  - a função da regra, caso a caso (NULL, pausa `manual`, marca depois da pausa…).
 *
 * Redis e canal AMQP são fakes em memória. Skip automático sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { planHumanReply } from '@hm/shared';
import { outboxRowsOf } from '../outbox/testing';
import { runReengagementTick, type ReengagementDeps } from './reengagement';
import { authorizeAiReply } from './run';

const url = process.env['DATABASE_URL'];

function makeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, _mode: string, _ttl: number, cond?: string) {
      if (cond === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK' as const;
    },
    async eval(_script: string, _n: number, ...args: string[]) {
      const [key, token] = args;
      if (key !== undefined && store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

describe.skipIf(!url)('marca humana x retomada automática (DB, F70-S23)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const sfx = WS.slice(0, 8);
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const convs = {
    resumed: randomUUID(),
    fromOff: randomUUID(),
    staleMark: randomUUID(),
  };

  async function row(id: string) {
    const [r] = await getDb()
      .select({
        origin: schema.conversations.origin,
        aiMode: schema.conversations.aiMode,
        aiPausedReason: schema.conversations.aiPausedReason,
        aiEnabledAt: schema.conversations.aiEnabledAt,
        aiAutoEnabledAt: schema.conversations.aiAutoEnabledAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    if (!r) throw new Error('conversa sumiu');
    return r;
  }

  /** O que a rota humana grava ao ligar a IA (`state.ts`/`agent.ts`), num instante dado. */
  async function humanTurnsOn(id: string, at: Date): Promise<void> {
    await getDb()
      .update(schema.conversations)
      .set({ aiMode: 'on', aiEnabledAt: at })
      .where(eq(schema.conversations.id, id));
  }

  /** Atendente responde: o patch real de `planHumanReply` (on → paused + human_takeover). */
  async function humanTakesOver(id: string, at: Date): Promise<void> {
    const plan = planHumanReply(
      { aiMode: 'on', firstResponseAt: null, aiLastHumanAt: null },
      { memberId: null, at, countsAsResponse: true },
    );
    expect(plan.paused).toBe(true);
    await getDb()
      .update(schema.conversations)
      .set(plan.patch)
      .where(eq(schema.conversations.id, id));
  }

  /** Caminho automático qualquer (flow, campanha, SQL): só `ai_mode`, sem marca humana. */
  async function automaticSet(id: string, aiMode: 'on' | 'off'): Promise<void> {
    await getDb()
      .update(schema.conversations)
      .set({ aiMode })
      .where(eq(schema.conversations.id, id));
  }

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F70S23 marca', slug: `f70s23-mk-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S23',
      phoneNumberId: `PN_F70S23_MK_${sfx}`,
      wabaId: `WABA_F70S23_MK_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55116' + sfx.replace(/\D/g, '6').padEnd(8, '6').slice(0, 8),
    });
    for (const id of Object.values(convs)) {
      await db.insert(schema.conversations).values({
        id,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId: CONTACT,
        remoteId: `r-${id.slice(0, 12)}`,
        origin: 'sem-origem',
        aiMode: 'off',
      });
    }
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  it('marca gravada antes da pausa sobrevive à pausa e à retomada automática', async () => {
    // Humano liga (3h atrás), atendente assume (2h atrás), fora de qualquer origem elegível.
    await humanTurnsOn(convs.resumed, threeHoursAgo);
    await humanTakesOver(convs.resumed, twoHoursAgo);
    // Controle negativo do cenário seguinte, no mesmo tick: marca vencida antes da pausa.
    await humanTurnsOn(convs.staleMark, threeHoursAgo);
    await automaticSet(convs.staleMark, 'off');
    await automaticSet(convs.staleMark, 'on');
    await humanTakesOver(convs.staleMark, now);
    await getDb()
      .update(schema.conversations)
      .set({ aiLastHumanAt: twoHoursAgo })
      .where(eq(schema.conversations.id, convs.staleMark));

    const before = await row(convs.resumed);
    expect(before).toMatchObject({ aiMode: 'paused', aiPausedReason: 'human_takeover' });
    expect(before.aiAutoEnabledAt).toBeNull();

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps = { redis: makeRedis(), logger } as unknown as ReengagementDeps;

    const res = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });
    expect(res).toMatchObject({ ran: true, enqueued: 1, blockedByOrigin: 1 });
    // F70-S25: o gatilho está na outbox, gravado com a retomada.
    const published = (await outboxRowsOf(WS))
      .filter((r) => r.routingKey === 'hm.q.flows')
      .map((r) => r.envelope.payload);
    expect(published).toEqual([expect.objectContaining({ conversationId: convs.resumed })]);

    const after = await row(convs.resumed);
    expect(after).toMatchObject({ aiMode: 'on', aiPausedReason: null, aiAutoEnabledAt: null });
    expect(after.aiEnabledAt?.getTime()).toBe(threeHoursAgo.getTime());
    // O worker de agentes responde: a marca humana segue válida.
    expect(authorizeAiReply(after)).toEqual({ allowed: true, basis: 'human' });

    // Marca vencida antes da pausa: não retoma, segue pausada e sem IA.
    const stale = await row(convs.staleMark);
    expect(stale).toMatchObject({ aiMode: 'paused', aiPausedReason: 'human_takeover' });
  });

  it('on automático a partir de off continua invalidando a marca', async () => {
    await humanTurnsOn(convs.fromOff, threeHoursAgo);
    expect(authorizeAiReply(await row(convs.fromOff))).toEqual({ allowed: true, basis: 'human' });

    // A IA sai (ex.: transfer_to_human grava `off`) e um caminho automático a religa.
    await automaticSet(convs.fromOff, 'off');
    await automaticSet(convs.fromOff, 'on');

    const r = await row(convs.fromOff);
    expect(r.aiAutoEnabledAt).not.toBeNull();
    expect(authorizeAiReply(r)).toEqual({ allowed: false });
  });

  it('F70-S30: trava desligada retoma a pausa de marca vencida e o worker responde', async () => {
    // `staleMark` ficou pausada no primeiro caso (marca vencida por um `on` automático).
    expect(await row(convs.staleMark)).toMatchObject({ aiMode: 'paused' });
    await getDb()
      .update(schema.workspaces)
      .set({ aiRequiresProvenOrigin: false })
      .where(eq(schema.workspaces.id, WS));
    try {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
      const deps = { redis: makeRedis(), logger } as unknown as ReengagementDeps;
      const res = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });
      expect(res).toMatchObject({ ran: true, enqueued: 1, blockedByOrigin: 0 });

      const r = await row(convs.staleMark);
      expect(r).toMatchObject({ aiMode: 'on', aiPausedReason: null });
      // Sem marca válida, só a trava desligada autoriza.
      expect(authorizeAiReply({ ...r, requiresProvenOrigin: true })).toEqual({ allowed: false });
      expect(authorizeAiReply({ ...r, requiresProvenOrigin: false })).toEqual({
        allowed: true,
        basis: 'origin_gate_off',
      });
    } finally {
      await getDb()
        .update(schema.workspaces)
        .set({ aiRequiresProvenOrigin: true })
        .where(eq(schema.workspaces.id, WS));
    }
  });

  it('a função da regra: só pausa human_takeover com marca válida anterior à pausa', async () => {
    const t = (iso: string) => sql`${iso}::timestamptz`;
    const cases: Array<{
      name: string;
      args: [string | null, string | null, string | null, string | null, string | null];
      expected: boolean;
    }> = [
      {
        name: 'válida',
        args: ['paused', 'human_takeover', '2099-01-02', '2099-01-01', null],
        expected: true,
      },
      {
        name: 'auto anterior à marca',
        args: ['paused', 'human_takeover', '2099-01-03', '2099-01-02', '2099-01-01'],
        expected: true,
      },
      {
        name: 'auto posterior à marca',
        args: ['paused', 'human_takeover', '2099-01-03', '2099-01-01', '2099-01-02'],
        expected: false,
      },
      {
        name: 'empate marca/auto',
        args: ['paused', 'human_takeover', '2099-01-03', '2099-01-01', '2099-01-01'],
        expected: false,
      },
      {
        name: 'marca depois da pausa',
        args: ['paused', 'human_takeover', '2099-01-01', '2099-01-02', null],
        expected: false,
      },
      {
        name: 'sem marca',
        args: ['paused', 'human_takeover', '2099-01-02', null, null],
        expected: false,
      },
      {
        name: 'pausa sem instante',
        args: ['paused', 'human_takeover', null, '2099-01-01', null],
        expected: false,
      },
      {
        name: 'pausa manual',
        args: ['paused', 'manual', '2099-01-02', '2099-01-01', null],
        expected: false,
      },
      { name: 'IA off', args: ['off', null, null, '2099-01-01', null], expected: false },
      {
        name: 'motivo NULL',
        args: ['paused', null, '2099-01-02', '2099-01-01', null],
        expected: false,
      },
    ];
    for (const c of cases) {
      const [mode, reason, pausedAt, enabledAt, autoAt] = c.args;
      const [out] = await getDb().execute<{ keeps: boolean }>(
        sql`select public.conversation_ai_resume_keeps_human_mark(
              ${mode}::text, ${reason}::text,
              ${pausedAt === null ? sql`null::timestamptz` : t(pausedAt)},
              ${enabledAt === null ? sql`null::timestamptz` : t(enabledAt)},
              ${autoAt === null ? sql`null::timestamptz` : t(autoAt)}) as keeps`,
      );
      expect(out?.keeps, c.name).toBe(c.expected);
    }
  });
});
