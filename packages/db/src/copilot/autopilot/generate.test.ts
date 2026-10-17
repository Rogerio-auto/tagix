/**
 * F73-S13 — gerador de sugestões contra o Postgres dev, com relógio fixo.
 *
 * O `now` entra explícito em `generateSuggestions` e TODOS os instantes semeados (mensagens, criação
 * e fechamento de negócios, decisões) são absolutos: o relógio do container do Postgres difere do
 * host e não pode influenciar nada. Cada teste cria o próprio workspace (regras de um não vazam
 * para o outro).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../../client';
import { copilotAutopilotRepo } from '../../repos/copilot/autopilot';
import { withWorkspace } from '../../rls';
import {
  channels,
  contacts,
  conversations,
  dealHistory,
  deals,
  members,
  messages,
  pipelines,
  stages,
  workspaces,
} from '../../schema';
import { copilotAutopilotRules, copilotSuggestions } from '../../schema/copilot';
import { loadStageDwell } from './confidence';
import { CREATE_PER_RULE_PER_TICK, PENDING_CAP_PER_RULE, generateSuggestions } from './generate';

const NOW = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY);

interface World {
  ws: string;
  owner: string;
  pipeline: string;
  channel: string;
  contact: string;
  stage: (name: string) => Promise<string>;
}

const worlds: string[] = [];

async function seedWorld(label: string): Promise<World> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [w] = await db
    .insert(workspaces)
    .values({ name: `S13 ${label}`, slug: `s13-${label}-${sfx}` })
    .returning();
  if (!w) throw new Error('seed ws');
  worlds.push(w.id);
  const [owner] = await db
    .insert(members)
    .values({
      workspaceId: w.id,
      authUserId: randomUUID(),
      email: `s13-${label}-${sfx}@test.local`,
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  const [pl] = await db.insert(pipelines).values({ workspaceId: w.id, name: 'Funil' }).returning();
  const [ct] = await db
    .insert(contacts)
    .values({ workspaceId: w.id, displayName: `C ${label}` })
    .returning();
  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: w.id,
      provider: 'meta_whatsapp',
      name: `WA ${label} ${sfx}`,
      phoneNumberId: `s13-pn-${label}-${sfx}`,
      wabaId: `s13-waba-${label}-${sfx}`,
    })
    .returning();
  if (!owner || !pl || !ct || !ch) throw new Error('seed base');
  let position = 0;
  return {
    ws: w.id,
    owner: owner.id,
    pipeline: pl.id,
    channel: ch.id,
    contact: ct.id,
    async stage(name) {
      const [s] = await db
        .insert(stages)
        .values({ workspaceId: w.id, pipelineId: pl.id, name, position: position++ })
        .returning({ id: stages.id });
      if (!s) throw new Error('seed stage');
      return s.id;
    },
  };
}

async function conversation(
  w: World,
  msgs: ReadonlyArray<readonly ['inbound' | 'outbound', Date]>,
): Promise<string> {
  const db = getDb();
  const [cv] = await db
    .insert(conversations)
    .values({
      workspaceId: w.ws,
      channelId: w.channel,
      remoteId: `s13-${randomUUID()}`,
      contactId: w.contact,
    })
    .returning({ id: conversations.id });
  if (!cv) throw new Error('seed conversation');
  for (const [direction, at] of msgs) {
    await db.insert(messages).values({
      workspaceId: w.ws,
      conversationId: cv.id,
      direction,
      senderType: direction === 'inbound' ? 'contact' : 'member',
      content: direction,
      providerTimestamp: at,
    });
  }
  return cv.id;
}

async function deal(
  w: World,
  stageId: string,
  over: Partial<typeof deals.$inferInsert> = {},
): Promise<string> {
  const [d] = await getDb()
    .insert(deals)
    .values({
      workspaceId: w.ws,
      pipelineId: w.pipeline,
      stageId,
      contactId: w.contact,
      title: `Negócio ${randomUUID().slice(0, 6)}`,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
      ...over,
    })
    .returning({ id: deals.id });
  if (!d) throw new Error('seed deal');
  return d.id;
}

async function rule(
  w: World,
  stageId: string,
  input: {
    mode?: 'off' | 'suggest' | 'daily_approval' | 'auto';
    idleDays: number;
    target: string;
    outbound?: boolean;
  },
): Promise<void> {
  await withWorkspace(w.ws, (tx) =>
    copilotAutopilotRepo.upsertRule(tx, {
      workspaceId: w.ws,
      stageId,
      mode: input.mode ?? 'suggest',
      criteria: {
        idle_days: input.idleDays,
        target_stage_id: input.target,
        require_last_outbound: input.outbound ?? false,
      },
      memberId: w.owner,
    }),
  );
}

const run = (w: World, now: Date = NOW) =>
  withWorkspace(w.ws, (tx) => generateSuggestions(tx, w.ws, now));

async function suggestions(w: World) {
  return withWorkspace(w.ws, (tx) =>
    tx.select().from(copilotSuggestions).where(eq(copilotSuggestions.workspaceId, w.ws)),
  );
}

afterAll(async () => {
  const db = getDb();
  for (const id of worlds) {
    await db.delete(deals).where(eq(deals.workspaceId, id));
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  await closeDb();
});

describe('generateSuggestions: cria', () => {
  it('só negócios abertos, parados há >= idle_days e com a última mensagem nossa; motivo à mão', async () => {
    const w = await seedWorld('cria');
    const orc = await w.stage('Orçamento enviado');
    const rea = await w.stage('Reativação');
    await rule(w, orc, { idleDays: 7, target: rea, outbound: true });

    // 06/10 cliente respondeu (idle 10), 07/10 12:00 BRT nós escrevemos. Qualifica.
    const ok = await deal(w, orc, {
      conversationId: await conversation(w, [
        ['inbound', new Date('2026-10-06T12:00:00Z')],
        ['outbound', new Date('2026-10-07T15:00:00Z')],
      ]),
    });
    // Cliente respondeu há 2 dias: não está parado.
    await deal(w, orc, {
      conversationId: await conversation(w, [
        ['outbound', daysAgo(5)],
        ['inbound', daysAgo(2)],
      ]),
    });
    // Parado, mas a última mensagem foi do cliente: a regra exige "última nossa".
    await deal(w, orc, {
      conversationId: await conversation(w, [['inbound', daysAgo(9)]]),
    });
    // Sem conversa: não tem "última mensagem nossa".
    await deal(w, orc, { updatedAt: daysAgo(20) });
    // Fechado: fora.
    await deal(w, orc, {
      closedAt: daysAgo(1),
      closedWon: false,
      conversationId: await conversation(w, [
        ['inbound', daysAgo(12)],
        ['outbound', daysAgo(11)],
      ]),
    });
    // Outro estágio sem regra: fora.
    await deal(w, rea, {
      conversationId: await conversation(w, [
        ['inbound', daysAgo(12)],
        ['outbound', daysAgo(11)],
      ]),
    });

    const result = await run(w);
    expect(result).toMatchObject({ rules: 1, invalidRules: 0, created: 1, pendingCount: 1 });

    const rows = await suggestions(w);
    expect(rows).toHaveLength(1);
    const s = rows[0];
    expect(s).toMatchObject({
      dealId: ok,
      fromStageId: orc,
      toStageId: rea,
      status: 'pending',
      reasonCode: 'idle_last_outbound',
      confidence: 'medium',
      proposalId: null,
    });
    expect(s?.reasonText).toBe(
      'Sem resposta há 10 dias; a última mensagem foi nossa, em 07/10. ' +
        'Confiança média: pouco histórico de negócios ganhos neste estágio.',
    );
  });

  it('daily_approval gera igual; off e auto não geram; sem exigir "última nossa" aceita a do cliente', async () => {
    const w = await seedWorld('modos');
    const a = await w.stage('A');
    const b = await w.stage('B');
    const off = await w.stage('Desligado');
    const auto = await w.stage('Auto');
    const target = await w.stage('Destino');
    await rule(w, a, { mode: 'daily_approval', idleDays: 3, target });
    await rule(w, b, { mode: 'suggest', idleDays: 3, target });
    await rule(w, off, { mode: 'off', idleDays: 3, target });
    await rule(w, auto, { mode: 'auto', idleDays: 3, target });

    const aDeal = await deal(w, a, { updatedAt: daysAgo(5) });
    const bDeal = await deal(w, b, {
      conversationId: await conversation(w, [['inbound', new Date('2026-10-10T12:00:00Z')]]),
    });
    await deal(w, off, { updatedAt: daysAgo(20) });
    await deal(w, auto, { updatedAt: daysAgo(20) });

    const result = await run(w);
    expect(result).toMatchObject({ rules: 2, created: 2 });
    const rows = await suggestions(w);
    expect(rows.map((r) => r.dealId).sort()).toEqual([aDeal, bDeal].sort());

    const sem = rows.find((r) => r.dealId === aDeal);
    expect(sem).toMatchObject({ reasonCode: 'idle_no_messages' });
    expect(sem?.reasonText.startsWith('Sem movimentação há 5 dias.')).toBe(true);

    const cliente = rows.find((r) => r.dealId === bDeal);
    expect(cliente).toMatchObject({ reasonCode: 'idle_last_inbound' });
    expect(
      cliente?.reasonText.startsWith(
        'Sem retorno nosso há 6 dias; a última mensagem foi do cliente, em 10/10.',
      ),
    ).toBe(true);
  });

  it('destino inválido (outro funil, igual à origem) não gera e é contado', async () => {
    const w = await seedWorld('invalida');
    const a = await w.stage('A');
    const same = await w.stage('Mesmo');
    await rule(w, a, { idleDays: 3, target: a });
    await rule(w, same, { idleDays: 3, target: randomUUID().replace(/^./, 'f') });
    await deal(w, a, { updatedAt: daysAgo(10) });
    const result = await run(w);
    expect(result).toMatchObject({ rules: 0, invalidRules: 2, created: 0, pendingCount: 0 });
  });
});

describe('generateSuggestions: não duplica', () => {
  it('rodar de novo no mesmo instante não cria nem expira nada; sob concorrência, uma só pendente por negócio', async () => {
    const w = await seedWorld('dup');
    const a = await w.stage('A');
    const b = await w.stage('B');
    await rule(w, a, { idleDays: 3, target: b });
    await deal(w, a, { updatedAt: daysAgo(8) });
    await deal(w, a, { updatedAt: daysAgo(9) });

    expect(await run(w)).toMatchObject({ created: 2, expired: 0, superseded: 0, pendingCount: 2 });
    expect(await run(w)).toMatchObject({ created: 0, expired: 0, superseded: 0, pendingCount: 2 });
    await Promise.all([run(w), run(w), run(w)]);
    expect(await suggestions(w)).toHaveLength(2);
  });
});

describe('generateSuggestions: expira', () => {
  it('cliente voltou a conversar → expired; saiu do estágio ou fechou → superseded', async () => {
    const w = await seedWorld('expira');
    const a = await w.stage('A');
    const b = await w.stage('B');
    const other = await w.stage('Outro');
    await rule(w, a, { idleDays: 5, target: b, outbound: true });

    const mk = async (): Promise<{ dealId: string; conv: string }> => {
      const conv = await conversation(w, [
        ['inbound', daysAgo(10)],
        ['outbound', daysAgo(9)],
      ]);
      return { dealId: await deal(w, a, { conversationId: conv }), conv };
    };
    const replied = await mk();
    const moved = await mk();
    const closed = await mk();
    const weNudged = await mk();
    const untouched = await mk();
    expect(await run(w)).toMatchObject({ created: 5, pendingCount: 5 });

    // O cliente respondeu ontem.
    await getDb()
      .insert(messages)
      .values({
        workspaceId: w.ws,
        conversationId: replied.conv,
        direction: 'inbound',
        senderType: 'contact',
        content: 'oi',
        providerTimestamp: daysAgo(1),
      });
    // Alguém moveu para outro estágio.
    await getDb().update(deals).set({ stageId: other }).where(eq(deals.id, moved.dealId));
    // Foi ganho.
    await getDb()
      .update(deals)
      .set({ closedAt: daysAgo(1), closedWon: true })
      .where(eq(deals.id, closed.dealId));
    // Nós escrevemos de novo: a última continua nossa e o cliente segue parado → continua.
    await getDb()
      .insert(messages)
      .values({
        workspaceId: w.ws,
        conversationId: weNudged.conv,
        direction: 'outbound',
        senderType: 'member',
        content: 'e então?',
        providerTimestamp: daysAgo(1),
      });

    expect(await run(w)).toMatchObject({
      created: 0,
      expired: 1,
      superseded: 2,
      pendingCount: 2,
    });
    const byDeal = new Map((await suggestions(w)).map((r) => [r.dealId, r.status]));
    expect(byDeal.get(replied.dealId)).toBe('expired');
    expect(byDeal.get(moved.dealId)).toBe('superseded');
    expect(byDeal.get(closed.dealId)).toBe('superseded');
    expect(byDeal.get(weNudged.dealId)).toBe('pending');
    expect(byDeal.get(untouched.dealId)).toBe('pending');

    // Depois que respondemos ao cliente que voltou, ele volta a ficar parado: sugestão nova (a
    // antiga ficou expired). As duas que seguiam pendentes não se repetem.
    await getDb()
      .insert(messages)
      .values({
        workspaceId: w.ws,
        conversationId: replied.conv,
        direction: 'outbound',
        senderType: 'member',
        content: 'claro!',
        providerTimestamp: daysAgo(0.5),
      });
    expect(await run(w, new Date(NOW.getTime() + 12 * DAY))).toMatchObject({
      created: 1,
      pendingCount: 3,
    });
  });

  it('regra desligada, removida ou com outro destino → superseded', async () => {
    const w = await seedWorld('regra');
    const a = await w.stage('A');
    const b = await w.stage('B');
    const c = await w.stage('C');
    const x = await w.stage('X');
    await rule(w, a, { idleDays: 3, target: b });
    await rule(w, x, { idleDays: 3, target: b });
    await deal(w, a, { updatedAt: daysAgo(8) });
    await deal(w, x, { updatedAt: daysAgo(8) });
    expect(await run(w)).toMatchObject({ created: 2 });

    await rule(w, a, { mode: 'off', idleDays: 3, target: b });
    await rule(w, x, { idleDays: 3, target: c }); // mesmo estágio, outro destino
    const out = await run(w);
    expect(out).toMatchObject({ superseded: 2, pendingCount: 1 });
    // A regra X com destino novo gera a sugestão nova na mesma passada.
    expect(out.created).toBe(1);
    const rows = await suggestions(w);
    expect(rows.filter((r) => r.status === 'superseded')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'pending').map((r) => r.toStageId)).toEqual([c]);
  });
});

describe('generateSuggestions: recusa e aprovação recentes suprimem', () => {
  it('recusada há 1 dia não volta; há 20 dias, volta', async () => {
    const w = await seedWorld('cooldown');
    const a = await w.stage('A');
    const b = await w.stage('B');
    await rule(w, a, { idleDays: 3, target: b });
    const d = await deal(w, a, { updatedAt: daysAgo(8) });
    await run(w);

    const reject = async (decidedAt: Date): Promise<void> => {
      await getDb()
        .update(copilotSuggestions)
        .set({ status: 'rejected', decidedBy: w.owner, decidedAt })
        .where(and(eq(copilotSuggestions.dealId, d), eq(copilotSuggestions.status, 'pending')));
    };
    await reject(daysAgo(1));
    expect(await run(w)).toMatchObject({ created: 0, pendingCount: 0 });
    expect(await run(w, new Date(NOW.getTime() + 5 * DAY))).toMatchObject({ created: 0 });

    // Mesma recusa, mas de 20 dias atrás.
    await getDb()
      .update(copilotSuggestions)
      .set({ decidedAt: daysAgo(20) })
      .where(eq(copilotSuggestions.dealId, d));
    expect(await run(w)).toMatchObject({ created: 1, pendingCount: 1 });
  });
});

describe('generateSuggestions: teto de segurança', () => {
  it('no máximo 200 pendentes por regra, as mais paradas primeiro', async () => {
    const w = await seedWorld('teto');
    const a = await w.stage('A');
    const b = await w.stage('B');
    await rule(w, a, { idleDays: 3, target: b });
    const total = PENDING_CAP_PER_RULE + 5;
    await getDb()
      .insert(deals)
      .values(
        Array.from({ length: total }, (_, i) => ({
          workspaceId: w.ws,
          pipelineId: w.pipeline,
          stageId: a,
          contactId: w.contact,
          title: `Teto ${i}`,
          // i = 0 é o mais parado (30 dias); os 5 últimos, os menos (4 dias).
          createdAt: daysAgo(i < total - 5 ? 30 : 4),
          updatedAt: daysAgo(i < total - 5 ? 30 : 4),
        })),
      );
    expect(CREATE_PER_RULE_PER_TICK).toBe(PENDING_CAP_PER_RULE);
    const first = await run(w);
    expect(first.created).toBe(PENDING_CAP_PER_RULE);
    expect(await run(w)).toMatchObject({ created: 0, pendingCount: PENDING_CAP_PER_RULE });
    const rows = await suggestions(w);
    expect(rows.every((r) => r.reasonText.includes('30 dias'))).toBe(true);
  });
});

describe('generateSuggestions: isolamento', () => {
  it('rodar num workspace não toca no outro', async () => {
    const a = await seedWorld('iso-a');
    const b = await seedWorld('iso-b');
    for (const w of [a, b]) {
      const s = await w.stage('A');
      const t = await w.stage('B');
      await rule(w, s, { idleDays: 3, target: t });
      await deal(w, s, { updatedAt: daysAgo(8) });
    }
    expect(await run(a)).toMatchObject({ created: 1 });
    expect(await suggestions(b)).toHaveLength(0);
  });
});

describe('confiança pelo histórico dos negócios ganhos', () => {
  /** Ganho que ficou `dwellDays` no estágio `from` antes de ir para `to` e fechar. */
  async function wonAfter(w: World, from: string, to: string, dwellDays: number, when = 60) {
    const created = daysAgo(when);
    const left = new Date(created.getTime() + dwellDays * DAY);
    const id = await deal(w, to, {
      createdAt: created,
      updatedAt: left,
      closedAt: new Date(left.getTime() + DAY),
      closedWon: true,
    });
    await getDb()
      .insert(dealHistory)
      .values({
        dealId: id,
        workspaceId: w.ws,
        eventType: 'stage_changed',
        fromValue: { stageId: from },
        toValue: { stageId: to },
        actorType: 'member',
        createdAt: left,
      });
  }

  it('p50/p90 dos 10 ganhos (1..10 dias): 5,5 e 9,1; uma permanência por negócio ganho', async () => {
    const w = await seedWorld('dwell');
    const a = await w.stage('A');
    const won = await w.stage('Ganho');
    for (let d = 1; d <= 10; d += 1) await wonAfter(w, a, won, d);
    // Fora da janela de 180 dias e perdido: não contam.
    await wonAfter(w, a, won, 100, 300);
    const lost = await deal(w, won, {
      createdAt: daysAgo(40),
      closedAt: daysAgo(30),
      closedWon: false,
    });
    await getDb()
      .insert(dealHistory)
      .values({
        dealId: lost,
        workspaceId: w.ws,
        eventType: 'stage_changed',
        fromValue: { stageId: a },
        toValue: { stageId: won },
        actorType: 'member',
        createdAt: daysAgo(35),
      });

    const dwell = await withWorkspace(w.ws, (tx) => loadStageDwell(tx, w.ws, [a, won], NOW));
    const stat = dwell.get(a);
    expect(stat?.wins).toBe(10);
    expect(stat?.p50Days).toBeCloseTo(5.5, 6);
    expect(stat?.p90Days).toBeCloseTo(9.1, 6);
    expect(dwell.has(won)).toBe(false);
  });

  it('negócios com idle 10, 7 e 5: high, medium, low; com 9 ganhos, medium fixo', async () => {
    const w = await seedWorld('conf');
    const thick = await w.stage('Histórico');
    const thin = await w.stage('Pouco histórico');
    const won = await w.stage('Ganho');
    const target = await w.stage('Reativação');
    for (let d = 1; d <= 10; d += 1) await wonAfter(w, thick, won, d);
    for (let d = 1; d <= 9; d += 1) await wonAfter(w, thin, won, d);
    await rule(w, thick, { idleDays: 3, target });
    await rule(w, thin, { idleDays: 3, target });

    const high = await deal(w, thick, { updatedAt: daysAgo(10) });
    const medium = await deal(w, thick, { updatedAt: daysAgo(7) });
    const low = await deal(w, thick, { updatedAt: daysAgo(5) });
    const fixed = await deal(w, thin, { updatedAt: daysAgo(40) });

    expect(await run(w)).toMatchObject({ created: 4 });
    const byDeal = new Map((await suggestions(w)).map((r) => [r.dealId, r]));
    expect(byDeal.get(high)?.confidence).toBe('high');
    expect(byDeal.get(medium)?.confidence).toBe('medium');
    expect(byDeal.get(low)?.confidence).toBe('low');
    expect(byDeal.get(fixed)?.confidence).toBe('medium');
    expect(byDeal.get(fixed)?.reasonText).toContain('pouco histórico');
    expect(byDeal.get(high)?.reasonText).toContain('quase todos os negócios ganhos');
    expect(byDeal.get(low)?.reasonText).toContain('dentro do tempo típico');
    for (const r of byDeal.values()) expect(r.reasonText).not.toMatch(/score|0[.,]\d/i);
  });
});

describe('regras e RLS', () => {
  it('a regra de um workspace não aparece para outro', async () => {
    const a = await seedWorld('rls-a');
    const b = await seedWorld('rls-b');
    const s = await a.stage('A');
    const t = await a.stage('B');
    await rule(a, s, { idleDays: 3, target: t });
    const seen = await withWorkspace(b.ws, (tx) =>
      tx.select().from(copilotAutopilotRules).where(eq(copilotAutopilotRules.stageId, s)),
    );
    expect(seen).toHaveLength(0);
  });
});
