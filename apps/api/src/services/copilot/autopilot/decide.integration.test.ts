/**
 * F73-S13 — aprovar e recusar sugestões do piloto pelo motor de propostas, com o executor REAL do
 * `deal.move` (F73-S08), regras de transição, automações dos estágios e hooks de produção, contra
 * o Postgres de dev. Cada teste usa os próprios negócios.
 */
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  copilotAutopilotRepo,
  copilotProposalsRepo,
  generateSuggestions,
  getDb,
  schema,
  withWorkspace,
} from '@hm/db';
import { moveDealsExecutor } from '../../../internal/copilot/act-crm/move-deals';
import {
  confirmAndRun,
  principalOf,
  type CrmWorld,
} from '../../../internal/copilot/act-crm/test-fixtures';
import { decideSuggestions, type DecideResult } from './decide';
import {
  captureEmitter,
  dealStage,
  seedCrmWorld,
  seedDeal,
  seedSuggestion,
  suggestionRow,
} from './test-fixtures';

const DAY = 24 * 60 * 60 * 1000;
let world: CrmWorld;
let rival: CrmWorld;
const cap = captureEmitter();

beforeAll(async () => {
  // O publicador de `deal:*` é global ao processo: o último mundo semeado o captura. O que
  // observamos (`world.dealEvents`) tem que ser o último.
  rival = await seedCrmWorld('AutopilotRival');
  world = await seedCrmWorld('AutopilotDecide');
});

afterAll(async () => {
  await world?.cleanup();
  await rival?.cleanup();
  await closeDb();
});

async function decide(
  memberId: string,
  ids: string[],
  decision: 'approve' | 'reject',
  w: CrmWorld = world,
): Promise<DecideResult> {
  const ws = w.ws.workspaceId;
  const principal = await withWorkspace(ws, (tx) => principalOf(tx, ws, memberId));
  return decideSuggestions(
    {
      engine: w.deps,
      executor: moveDealsExecutor,
      emit: cap.emit,
      scoped: (fn) => withWorkspace(ws, fn),
    },
    principal,
    { ids, decision },
  );
}

async function proposal(id: string) {
  const loaded = await withWorkspace(world.ws.workspaceId, (tx) =>
    copilotProposalsRepo.getWithItems(tx, id),
  );
  if (!loaded) throw new Error('proposta sumiu');
  return loaded;
}

describe('aprovar: uma proposta autopilot executada como quem aprovou', () => {
  it('3 negócios: nível 3 pré-confirmado, desfazer em 7 dias, auditoria `autopilot`', async () => {
    const admin = world.ws.members.ADMIN.id;
    const a = await seedSuggestion(world, { title: 'Alinhador Ana' });
    const b = await seedSuggestion(world, {
      title: 'Alinhador Bia',
      owner: world.ws.members.AGENT.id,
    });
    const c = await seedSuggestion(world, { title: 'Alinhador Caio', owner: null });
    const before = Date.now();

    const out = await decide(admin, [a.id, b.id, c.id], 'approve');
    expect(out).toMatchObject({
      decision: 'approve',
      approved: 3,
      skipped: 0,
      not_found: 0,
      awaiting_confirmation: 0,
      in_progress: false,
      summary: 'Aprovadas 3',
    });
    expect(out.results.map((r) => r.status)).toEqual(['approved', 'approved', 'approved']);
    expect(out.proposals).toHaveLength(1);
    const ref = out.proposals[0];
    expect(ref).toMatchObject({
      to_stage_id: world.stage.reativacao,
      status: 'completed',
      risk_level: 3,
    });

    // O que o motor gravou.
    const { proposal: row, items } = await proposal(ref!.proposal_id);
    expect(row).toMatchObject({
      source: 'autopilot',
      capability: 'deal.move',
      status: 'completed',
      requestedByMemberId: admin,
      executedAsMemberId: admin,
      turnId: null,
      sessionId: null,
    });
    expect(items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    // Desfazer por 7 dias a partir da conclusão.
    expect(row.undoDeadline).not.toBeNull();
    const undoMs = (row.undoDeadline as Date).getTime();
    expect(undoMs).toBeGreaterThan(before + 7 * DAY - 60_000);
    expect(undoMs).toBeLessThan(Date.now() + 7 * DAY + 60_000);
    expect(ref!.undo_until).toBe((row.undoDeadline as Date).toISOString());

    // Auditoria: ator `autopilot`, com as permissões do aprovador.
    const audits = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.copilotProposalId, row.id))
      .orderBy(desc(schema.auditLogs.createdAt));
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(audits.map((x) => x.actorType))).toEqual(new Set(['autopilot']));
    expect(audits.every((x) => x.requestedByMemberId === admin)).toBe(true);
    expect(audits.some((x) => x.actorMemberId === admin)).toBe(true);

    // Os negócios andaram, com o aprovador no histórico e a origem `autopilot`.
    for (const s of [a, b, c]) expect(await dealStage(s.dealId)).toBe(world.stage.reativacao);
    const [hist] = await getDb()
      .select()
      .from(schema.dealHistory)
      .where(
        and(
          eq(schema.dealHistory.dealId, a.dealId),
          eq(schema.dealHistory.eventType, 'stage_changed'),
        ),
      );
    expect(hist).toMatchObject({ actorMemberId: admin, actorType: 'member' });
    expect(hist?.metadata).toMatchObject({ via: 'autopilot', proposal_id: row.id });

    // As sugestões ficam `approved`, ligadas à proposta, com quem decidiu.
    for (const s of [a, b, c]) {
      expect(await suggestionRow(world, s.id)).toMatchObject({
        status: 'approved',
        proposalId: row.id,
        decidedBy: admin,
      });
    }
    // A contagem sem PII para o socket.
    expect(cap.calls.at(-1)?.workspaceId).toBe(world.ws.workspaceId);
    expect(typeof cap.calls.at(-1)?.pendingCount).toBe('number');
  });

  it('1 negócio: nível 2 executa dentro da transação e os efeitos saem só depois do commit', async () => {
    const s = await seedSuggestion(world, { title: 'Alinhador Solo' });
    const out = await decide(world.ws.members.SUPERVISOR.id, [s.id], 'approve');
    expect(out).toMatchObject({ approved: 1, in_progress: false, summary: 'Aprovadas 1' });
    const ref = out.proposals[0];
    expect(ref).toMatchObject({ status: 'completed', risk_level: 2 });
    const { proposal: row } = await proposal(ref!.proposal_id);
    expect(row.undoDeadline!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);

    expect(await dealStage(s.dealId)).toBe(world.stage.reativacao);
    // `deal:stage_changed` foi publicado com o negócio JÁ commitado no estágio de destino.
    const event = world.dealEvents.find((e) => e.data['dealId'] === s.dealId);
    expect(event?.committedStageId).toBe(world.stage.reativacao);
  });

  it('um destino por proposta: sugestões para estágios diferentes viram propostas diferentes', async () => {
    const a = await seedSuggestion(world, { title: 'Dest A1' });
    const b = await seedSuggestion(world, { title: 'Dest A2' });
    const c = await seedSuggestion(world, { title: 'Dest B1', to: world.stage.avisar });
    const out = await decide(world.ws.members.OWNER.id, [a.id, b.id, c.id], 'approve');
    expect(out.approved).toBe(3);
    expect(out.proposals.map((p) => p.to_stage_id).sort()).toEqual(
      [world.stage.reativacao, world.stage.avisar].sort(),
    );
    expect(new Set(out.proposals.map((p) => p.proposal_id)).size).toBe(2);
    expect(await dealStage(c.dealId)).toBe(world.stage.avisar);
  });
});

describe('aprovar: o que é pulado, e por quê', () => {
  it('editado depois da sugestão: "Aprovadas 2, puladas 1 (editada por Paula Gestora)"', async () => {
    const a = await seedSuggestion(world, { title: 'Ed A' });
    const b = await seedSuggestion(world, { title: 'Ed B' });
    const c = await seedSuggestion(world, { title: 'Ed C' });
    // A Paula mexeu no B depois que a sugestão nasceu.
    const sug = await suggestionRow(world, b.id);
    const editedAt = new Date(sug!.createdAt.getTime() + 30 * 60_000);
    await getDb()
      .update(schema.deals)
      .set({ updatedAt: new Date(editedAt.getTime() + 60_000) })
      .where(eq(schema.deals.id, b.dealId));
    await getDb().insert(schema.dealHistory).values({
      dealId: b.dealId,
      workspaceId: world.ws.workspaceId,
      eventType: 'field_updated',
      actorMemberId: world.paula,
      actorType: 'member',
      createdAt: editedAt,
    });

    const out = await decide(world.ws.members.ADMIN.id, [a.id, b.id, c.id], 'approve');
    expect(out).toMatchObject({ approved: 2, skipped: 1 });
    expect(out.summary).toBe('Aprovadas 2, puladas 1 (editada por Paula Gestora)');
    expect(out.results[1]).toMatchObject({
      id: b.id,
      status: 'skipped',
      reason: 'edited',
      edited_by: 'Paula Gestora',
    });
    expect(await dealStage(b.dealId)).toBe(world.stage.orcamento);
    // A sugestão velha sai da fila; o gerador cria a nova se o negócio ainda se qualifica.
    expect((await suggestionRow(world, b.id))?.status).toBe('superseded');
  });

  it('negócio que saiu do estágio ou foi fechado: pulado, sugestão superseded', async () => {
    const moved = await seedSuggestion(world, { title: 'Saiu' });
    const closed = await seedSuggestion(world, { title: 'Fechou' });
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.flow })
      .where(eq(schema.deals.id, moved.dealId));
    await getDb()
      .update(schema.deals)
      .set({ closedAt: new Date(), closedWon: true })
      .where(eq(schema.deals.id, closed.dealId));
    const out = await decide(world.ws.members.ADMIN.id, [moved.id, closed.id], 'approve');
    expect(out).toMatchObject({ approved: 0, skipped: 2, proposals: [] });
    expect(out.summary).toBe('Aprovadas 0, puladas 2 (2 saíram do estágio)');
    expect((await suggestionRow(world, moved.id))?.status).toBe('superseded');
    expect((await suggestionRow(world, closed.id))?.status).toBe('superseded');
    expect(await dealStage(moved.dealId)).toBe(world.stage.flow);
  });

  it('decisão é única: já decidida ou expirada é pulada, sem nova proposta', async () => {
    const a = await seedSuggestion(world, { title: 'Única' });
    const expired = await seedSuggestion(world, { title: 'Expirada', status: 'expired' });
    const first = await decide(world.ws.members.ADMIN.id, [a.id], 'reject');
    expect(first).toMatchObject({ rejected: 1, summary: 'Recusadas 1' });
    const again = await decide(world.ws.members.ADMIN.id, [a.id, expired.id], 'approve');
    expect(again).toMatchObject({ approved: 0, skipped: 2, proposals: [] });
    expect(again.results.map((r) => r.reason)).toEqual(['already_decided', 'already_decided']);
    expect(await dealStage(a.dealId)).toBe(world.stage.orcamento);
  });

  it('duas decisões ao mesmo tempo no mesmo lote: uma proposta só, o resto "já decidida"', async () => {
    const batch = [
      await seedSuggestion(world, { title: 'Corrida 1' }),
      await seedSuggestion(world, { title: 'Corrida 2' }),
      await seedSuggestion(world, { title: 'Corrida 3' }),
    ];
    const ids = batch.map((b) => b.id);
    const [x, y] = await Promise.all([
      decide(world.ws.members.ADMIN.id, ids, 'approve'),
      decide(world.ws.members.OWNER.id, ids, 'approve'),
    ]);
    expect([x.approved, y.approved].sort()).toEqual([0, 3]);
    expect(x.proposals.length + y.proposals.length).toBe(1);
    const loser = x.approved === 0 ? x : y;
    expect(loser.results.map((r) => r.reason)).toEqual([
      'already_decided',
      'already_decided',
      'already_decided',
    ]);
    for (const b of batch) {
      const moved = await getDb()
        .select()
        .from(schema.dealHistory)
        .where(
          and(
            eq(schema.dealHistory.dealId, b.dealId),
            eq(schema.dealHistory.eventType, 'stage_changed'),
          ),
        );
      expect(moved).toHaveLength(1);
    }
  });

  it('destino exige aprovação no Pipeline: o motor pula o item (policy)', async () => {
    const s = await seedSuggestion(world, { title: 'Contrato', to: world.stage.aprovacao });
    const out = await decide(world.ws.members.ADMIN.id, [s.id], 'approve');
    expect(out).toMatchObject({ approved: 0, skipped: 1 });
    expect(out.results[0]).toMatchObject({ status: 'skipped', reason: 'policy' });
    expect(out.summary).toBe('Aprovadas 0, puladas 1 (o destino exige aprovação no Pipeline)');
    expect(await dealStage(s.dealId)).toBe(world.stage.orcamento);
  });

  it('nível 4 (a automação do destino fala com o cliente): fica proposta, a pessoa confirma depois', async () => {
    const a = await seedSuggestion(world, { title: 'WhatsApp 1', to: world.stage.whatsapp });
    const b = await seedSuggestion(world, { title: 'WhatsApp 2', to: world.stage.whatsapp });
    const admin = world.ws.members.ADMIN.id;
    const out = await decide(admin, [a.id, b.id], 'approve');
    expect(out).toMatchObject({ approved: 0, awaiting_confirmation: 2 });
    expect(out.summary).toBe('Aprovadas 0, aguardando confirmação 2');
    const ref = out.proposals[0];
    expect(ref).toMatchObject({ status: 'proposed', risk_level: 4, undo_until: null });
    expect(
      out.results.every(
        (r) => r.status === 'awaiting_confirmation' && r.proposal_id === ref!.proposal_id,
      ),
    ).toBe(true);
    // Nada andou e as sugestões já apontam para a proposta.
    expect(await dealStage(a.dealId)).toBe(world.stage.orcamento);
    expect(await suggestionRow(world, a.id)).toMatchObject({
      status: 'approved',
      proposalId: ref!.proposal_id,
    });

    // Confirma com "Revisei": o motor executa; a janela de desfazer do piloto não muda.
    const done = await confirmAndRun(world, admin, ref!.proposal_id);
    expect(done.proposal.status).toBe('completed');
    expect(await dealStage(a.dealId)).toBe(world.stage.whatsapp);
  });

  it('o motor recusa (matriz do Copiloto desliga deal.move): sugestões voltam a pendentes', async () => {
    const a = await seedSuggestion(world, { title: 'Bloq 1' });
    const b = await seedSuggestion(world, { title: 'Bloq 2' });
    await getDb()
      .insert(schema.copilotSettings)
      .values({
        workspaceId: world.ws.workspaceId,
        capabilityMatrix: { ADMIN: { 'deal.move': false } },
      });
    try {
      const out = await decide(world.ws.members.ADMIN.id, [a.id, b.id], 'approve');
      expect(out).toMatchObject({ approved: 0, skipped: 2 });
      expect(out.results.map((r) => r.reason)).toEqual(['blocked', 'blocked']);
      for (const s of [a, b]) {
        expect(await suggestionRow(world, s.id)).toMatchObject({
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          proposalId: null,
        });
        expect(await dealStage(s.dealId)).toBe(world.stage.orcamento);
      }
    } finally {
      await getDb()
        .delete(schema.copilotSettings)
        .where(eq(schema.copilotSettings.workspaceId, world.ws.workspaceId));
    }
    // Com a matriz de volta, o mesmo lote passa.
    const ok = await decide(world.ws.members.ADMIN.id, [a.id, b.id], 'approve');
    expect(ok.approved).toBe(2);
  });
});

describe('escopo: o que o membro não vê não existe para ele', () => {
  it('AGENT decide só os seus (ou os de conversa que vê); os do OWNER são not_found e intactos', async () => {
    const agent = world.ws.members.AGENT.id;
    const mine = await seedSuggestion(world, { title: 'Meu', owner: agent });
    const viaConv = await seedSuggestion(world, {
      title: 'Da minha conversa',
      owner: world.ws.members.OWNER.id,
      conv: world.conv.agent,
    });
    const others = await seedSuggestion(world, {
      title: 'Do dono',
      owner: world.ws.members.OWNER.id,
    });
    const bConv = await seedSuggestion(world, {
      title: 'Do colega',
      owner: world.ws.members.OWNER.id,
      conv: world.conv.agentB,
    });

    const out = await decide(agent, [mine.id, viaConv.id, others.id, bConv.id], 'approve');
    expect(out.results.map((r) => r.status)).toEqual([
      'approved',
      'approved',
      'not_found',
      'not_found',
    ]);
    expect(out).toMatchObject({ approved: 2, not_found: 2 });
    expect(out.summary).toBe('Aprovadas 2, não encontradas 2');
    expect(await dealStage(mine.dealId)).toBe(world.stage.reativacao);
    expect(await dealStage(others.dealId)).toBe(world.stage.orcamento);
    expect((await suggestionRow(world, others.id))?.status).toBe('pending');

    // Executou como o AGENT.
    const { proposal: row } = await proposal(out.proposals[0]!.proposal_id);
    expect(row).toMatchObject({
      executedAsMemberId: agent,
      requestedByMemberId: agent,
      source: 'autopilot',
    });
  });

  it('AGENT também só recusa o que enxerga', async () => {
    const agent = world.ws.members.AGENT.id;
    const mine = await seedSuggestion(world, { title: 'Recusa minha', owner: agent });
    const others = await seedSuggestion(world, {
      title: 'Recusa do dono',
      owner: world.ws.members.OWNER.id,
    });
    const out = await decide(agent, [mine.id, others.id], 'reject');
    expect(out.results.map((r) => r.status)).toEqual(['rejected', 'not_found']);
    expect((await suggestionRow(world, others.id))?.status).toBe('pending');
  });

  it('id de outro workspace é not_found e a sugestão de lá fica intacta', async () => {
    const foreign = await seedSuggestion(rival, { title: 'Alheia' });
    const out = await decide(world.ws.members.OWNER.id, [foreign.id], 'approve');
    expect(out.results).toEqual([{ id: foreign.id, status: 'not_found' }]);
    expect((await suggestionRow(rival, foreign.id))?.status).toBe('pending');
    expect(await dealStage(foreign.dealId)).toBe(rival.stage.orcamento);
  });
});

describe('recusar', () => {
  it('marca rejected com quem e quando, sem proposta, e não mexe no negócio', async () => {
    const a = await seedSuggestion(world, { title: 'Rej 1' });
    const b = await seedSuggestion(world, { title: 'Rej 2' });
    const supervisor = world.ws.members.SUPERVISOR.id;
    const out = await decide(supervisor, [a.id, b.id], 'reject');
    expect(out).toMatchObject({ rejected: 2, approved: 0, proposals: [], summary: 'Recusadas 2' });
    for (const s of [a, b]) {
      const row = await suggestionRow(world, s.id);
      expect(row).toMatchObject({ status: 'rejected', decidedBy: supervisor, proposalId: null });
      expect(row?.decidedAt).toBeInstanceOf(Date);
      expect(await dealStage(s.dealId)).toBe(world.stage.orcamento);
    }
  });
});

describe('ponta a ponta: o gerador cria, a aprovação move', () => {
  it('regra → sugestão do gerador → aprovar → negócio no destino, desfazer em 7 dias', async () => {
    const ws = rival.ws.workspaceId;
    const admin = rival.ws.members.ADMIN.id;
    await withWorkspace(ws, (tx) =>
      copilotAutopilotRepo.upsertRule(tx, {
        workspaceId: ws,
        stageId: rival.stage.flow,
        mode: 'daily_approval',
        criteria: {
          idle_days: 7,
          target_stage_id: rival.stage.reativacao,
          require_last_outbound: false,
        },
        memberId: admin,
      }),
    );
    const dealId = await seedDeal(rival, {
      title: 'Gerado',
      stage: rival.stage.flow,
      idleDays: 12,
    });
    const gen = await withWorkspace(ws, (tx) => generateSuggestions(tx, ws, new Date()));
    expect(gen).toMatchObject({ rules: 1, created: 1 });

    const [sug] = await getDb()
      .select()
      .from(schema.copilotSuggestions)
      .where(eq(schema.copilotSuggestions.dealId, dealId));
    expect(sug).toMatchObject({ status: 'pending', toStageId: rival.stage.reativacao });
    expect(sug?.reasonText).toContain('Sem movimentação há 12 dias');

    const out = await decide(admin, [sug!.id], 'approve', rival);
    expect(out).toMatchObject({ approved: 1, summary: 'Aprovadas 1' });
    expect(await dealStage(dealId)).toBe(rival.stage.reativacao);
    const [row] = await getDb()
      .select()
      .from(schema.copilotActionProposals)
      .where(eq(schema.copilotActionProposals.id, out.proposals[0]!.proposal_id));
    expect(row).toMatchObject({
      source: 'autopilot',
      status: 'completed',
      executedAsMemberId: admin,
    });
    expect(row?.undoDeadline!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);

    // Já movido: o gerador não volta a sugerir, e o que está aprovado não reaparece.
    const again = await withWorkspace(ws, (tx) => generateSuggestions(tx, ws, new Date()));
    expect(again).toMatchObject({ created: 0 });
  });
});
