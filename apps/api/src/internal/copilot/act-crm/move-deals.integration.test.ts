/**
 * F73-S08 · `propose_move_deals` (deal.move) de ponta a ponta no Postgres de dev.
 *
 * - O fluxo da A4: 7 negócios parados há 7+ dias em "Orçamento enviado" → Reativação; a Paula
 *   move 2 entre propor e confirmar; resultado 5 de 7 com o nome dela; desfazer dos 5.
 * - `deal:stage_changed` por item e SÓ depois do commit (lido por outra conexão no momento da
 *   publicação).
 * - Desfazer não agenda automação e cancela as `pending_automations` da movimentação original.
 * - Automação de estágio: send_message/trigger_flow/register_conversion → nível 4 com a linha na
 *   prévia; notify_members → nível ≥ 3; requiresApproval → skipped_policy.
 * - Prévia (Δ previsão, critério, avisados), escopo do AGENT, entre empresas, avisar responsáveis.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { moveDeal } from '../../../services/deals/move';
import { toProposalItem } from '../../../services/copilot/proposals/items';
import { moveDealsExecutor } from './move-deals';
import {
  confirmAndRun,
  load,
  memberOf,
  previewOf,
  propose,
  rowOf,
  seedCrmWorld,
  seedDeal,
  undo,
  type CrmWorld,
} from './test-fixtures';

let world: CrmWorld;

beforeAll(async () => {
  world = await seedCrmWorld('MoveDeals');
});

afterAll(async () => {
  await world?.cleanup();
  await closeDb();
});

const ws = (): string => world.ws.workspaceId;

async function stageOf(dealId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ stageId: schema.deals.stageId })
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId));
  return row?.stageId;
}

async function pendingOf(dealId: string) {
  return getDb()
    .select({
      status: schema.pendingAutomations.status,
      lastError: schema.pendingAutomations.lastError,
      rule: schema.pendingAutomations.rule,
    })
    .from(schema.pendingAutomations)
    .where(eq(schema.pendingAutomations.dealId, dealId));
}

describe('A4: mover os parados há 7 dias para Reativação', () => {
  it('7 negócios, 2 alterados pela Paula → 5 de 7 com o nome dela; desfazer dos 5', async () => {
    const owner = memberOf(world, 'OWNER');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(
        await seedDeal(world, {
          title: `A4 negócio ${i}`,
          stage: world.stage.orcamento,
          idleDays: 8 + i,
          cents: 500_000 + i * 100_000,
        }),
      );
    }
    // Um parado há só 2 dias e um já em Reativação: fora do critério.
    const fresh = await seedDeal(world, {
      title: 'A4 recente',
      stage: world.stage.orcamento,
      idleDays: 2,
    });

    const outcome = await propose(world, owner, moveDealsExecutor, {
      filter: { stage_ids: [world.stage.orcamento], idle_days_gte: 7 },
      to_stage_id: world.stage.reativacao,
    });
    expect(outcome.kind).toBe('proposed');
    const row = rowOf(outcome);
    expect(row.riskLevel).toBe(3);
    expect(row.summary).toBe('Mover 7 negócios de Orçamento enviado para Reativação');
    const preview = previewOf(row);
    expect(preview.impact.affected_count).toBe(7);
    expect(preview.impact.criterion).toBe(
      'Em aberto em Orçamento enviado, cliente sem responder há 7 dias ou mais',
    );
    expect(preview.before_after[0]).toEqual({
      label: 'Estágio',
      before: 'Orçamento enviado',
      after: 'Reativação',
      count: 7,
    });
    // As automações internas de Reativação aparecem; a desligada, não.
    const texts = preview.before_after.map((r) => r.after);
    expect(
      texts.some((t) => t.startsWith('Ao entrar em Reativação, a automação adiciona a tag')),
    ).toBe(true);
    expect(texts.some((t) => t.includes('desligada'))).toBe(false);
    // Nenhum nome de contato no resumo.
    expect(row.summary).not.toContain('Maria');
    const items0 = (await load(world, row.id)).items;
    expect(items0.map((i) => i.targetId).sort()).toEqual([...ids].sort());
    expect(items0.some((i) => i.targetId === fresh)).toBe(false);

    // Entre propor e confirmar, a Paula move dois pela tela.
    const touched = ids.slice(0, 2);
    for (const id of touched) {
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.workspace_id', ${ws()}, true)`);
        await moveDeal(tx, {
          dealId: id,
          newStageId: world.stage.aprovacao,
          actor: { type: 'member', memberId: world.paula, role: 'SUPERVISOR' },
          workspaceId: ws(),
        });
      });
    }
    world.dealEvents.length = 0;

    const done = await confirmAndRun(world, owner, row.id);
    expect(done.proposal.status).toBe('partially_completed');
    const byStatus = (s: string) => done.items.filter((i) => i.status === s);
    expect(byStatus('done')).toHaveLength(5);
    expect(byStatus('skipped_conflict')).toHaveLength(2);
    for (const item of byStatus('skipped_conflict')) {
      expect(touched).toContain(item.targetId);
      expect(item.after?.['conflict_by']).toBe('Paula Gestora');
      expect(toProposalItem(item).reason).toBe('Editado por Paula Gestora depois da prévia');
    }
    for (const id of ids.slice(2)) expect(await stageOf(id)).toBe(world.stage.reativacao);
    for (const id of touched) expect(await stageOf(id)).toBe(world.stage.aprovacao);

    // deal:stage_changed: um por item movido, publicado depois do commit do item.
    const moved = world.dealEvents.filter((e) => e.event === 'deal:stage_changed');
    expect(moved.map((e) => e.data['dealId']).sort()).toEqual(ids.slice(2).sort());
    for (const e of moved) {
      expect(e.data['toStageId']).toBe(world.stage.reativacao);
      expect(e.committedStageId).toBe(world.stage.reativacao);
      expect(e.data['movedBy']).toBe(owner);
    }
    // Histórico com ator e correlação.
    const [hist] = await getDb()
      .select({ actor: schema.dealHistory.actorMemberId, metadata: schema.dealHistory.metadata })
      .from(schema.dealHistory)
      .where(
        and(
          eq(schema.dealHistory.dealId, ids[2]!),
          eq(schema.dealHistory.eventType, 'stage_changed'),
        ),
      );
    expect(hist?.actor).toBe(owner);
    expect(hist?.metadata).toEqual({ via: 'copilot', proposal_id: row.id });

    // Desfazer: os 5 voltam; os 2 da Paula ficam onde ela os deixou.
    world.dealEvents.length = 0;
    const undone = await undo(world, owner, row.id);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.row.status).toBe('undone');
    expect(undone.items.filter((i) => i.status === 'undone')).toHaveLength(5);
    for (const id of ids.slice(2)) expect(await stageOf(id)).toBe(world.stage.orcamento);
    for (const id of touched) expect(await stageOf(id)).toBe(world.stage.aprovacao);
    const back = world.dealEvents.filter((e) => e.event === 'deal:stage_changed');
    expect(back).toHaveLength(5);
    for (const e of back) expect(e.committedStageId).toBe(world.stage.orcamento);
  });
});

describe('desfazer movimentação × automações do estágio', () => {
  it('não agenda automação e cancela as pendentes da movimentação original', async () => {
    const owner = memberOf(world, 'OWNER');
    const a = await seedDeal(world, { title: 'Auto A', stage: world.stage.orcamento });
    const b = await seedDeal(world, { title: 'Auto B', stage: world.stage.orcamento });
    const row = rowOf(
      await propose(world, owner, moveDealsExecutor, {
        deal_ids: [a, b],
        to_stage_id: world.stage.reativacao,
      }),
    );
    await confirmAndRun(world, owner, row.id);

    // A movimentação agendou o on_enter de Reativação (com 1 h de espera), marcado com a proposta.
    for (const id of [a, b]) {
      const pending = await pendingOf(id);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.status).toBe('pending');
      expect(pending[0]?.rule.action).toBe('add_tag');
      expect((pending[0]?.rule as unknown as Record<string, unknown>)['metadata']).toEqual({
        via: 'copilot',
        proposal_id: row.id,
      });
    }
    // Uma automação de OUTRA origem (não desta proposta) fica intocada.
    const [foreign] = await getDb()
      .insert(schema.pendingAutomations)
      .values({
        workspaceId: ws(),
        dealId: a,
        rule: {
          id: 'x',
          trigger: 'on_enter',
          action: 'add_tag',
          config: { kind: 'add_tag', tagId: world.tag.vip },
          delaySeconds: 0,
          enabled: true,
        },
        scheduledAt: new Date(Date.now() + 3_600_000),
        status: 'pending',
      })
      .returning({ id: schema.pendingAutomations.id });

    const undone = await undo(world, owner, row.id);
    expect(undone.ok && undone.row.status).toBe('undone');

    for (const id of [a, b]) {
      expect(await stageOf(id)).toBe(world.stage.orcamento);
      const rows = await pendingOf(id);
      const mine = rows.filter(
        (r) => (r.rule as unknown as Record<string, unknown>)['metadata'] !== undefined,
      );
      // Cancelada a da movimentação; nada novo agendado (nem o on_exit de Reativação, nem o
      // on_enter de Orçamento enviado).
      expect(mine).toHaveLength(1);
      expect(mine[0]?.status).toBe('failed');
      expect(mine[0]?.lastError).toBe('cancelled_by_undo');
      expect(rows.filter((r) => r.status === 'pending' && r.rule.id !== 'x')).toHaveLength(0);
    }
    const [still] = await getDb()
      .select({ status: schema.pendingAutomations.status })
      .from(schema.pendingAutomations)
      .where(eq(schema.pendingAutomations.id, foreign!.id));
    expect(still?.status).toBe('pending');
    // Histórico da volta marcado como desfazer.
    const hist = await getDb()
      .select({ metadata: schema.dealHistory.metadata })
      .from(schema.dealHistory)
      .where(
        and(eq(schema.dealHistory.dealId, a), eq(schema.dealHistory.eventType, 'stage_changed')),
      );
    expect(hist.map((h) => h.metadata)).toContainEqual({
      via: 'copilot',
      proposal_id: row.id,
      origin: 'undo',
    });
  });

  it('desfazer com conflito: negócio já saiu de onde o Copiloto o deixou → undo_conflict', async () => {
    const owner = memberOf(world, 'OWNER');
    const id = await seedDeal(world, {
      title: 'Conflito no desfazer',
      stage: world.stage.orcamento,
    });
    const outcome = await propose(world, owner, moveDealsExecutor, {
      deal_ids: [id],
      to_stage_id: world.stage.reativacao,
    });
    expect(outcome.kind).toBe('executed');
    const row = rowOf(outcome);
    expect(row.riskLevel).toBe(2);
    await getDb()
      .update(schema.deals)
      .set({ stageId: world.stage.aprovacao })
      .where(eq(schema.deals.id, id));
    const undone = await undo(world, owner, row.id);
    expect(undone.ok && undone.row.status).toBe('partially_undone');
    if (!undone.ok) return;
    expect(undone.items[0]?.status).toBe('undo_conflict');
    expect(await stageOf(id)).toBe(world.stage.aprovacao);
  });
});

describe('automação de estágio decide o nível', () => {
  it('send_message no on_enter do destino → nível 4 com a linha na prévia e na política', async () => {
    const id = await seedDeal(world, { title: 'L4 msg', stage: world.stage.orcamento });
    const outcome = await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
      deal_ids: [id],
      to_stage_id: world.stage.whatsapp,
    });
    expect(outcome.kind).toBe('proposed');
    const row = rowOf(outcome);
    expect(row.riskLevel).toBe(4);
    const line =
      "Ao entrar em Retomada por WhatsApp, a automação envia a mensagem 'retomada' ao cliente";
    expect(previewOf(row).before_after).toContainEqual({
      label: 'Automação do estágio (fala com o cliente)',
      before: '—',
      after: line,
      count: 1,
    });
    expect(row.policyChecks).toContainEqual({
      key: 'stage_automation',
      status: 'warn',
      label: 'Automação do estágio',
      detail: line,
    });
    expect(await stageOf(id)).toBe(world.stage.orcamento);
    // Nível 4 confirmado move; sem desfazer (a mensagem não volta).
    const done = await confirmAndRun(world, memberOf(world, 'OWNER'), row.id);
    expect(done.proposal.status).toBe('completed');
    expect(done.proposal.undoDeadline).toBeNull();
  });

  it('trigger_flow no destino e register_conversion no on_exit da origem → nível 4', async () => {
    const a = await seedDeal(world, { title: 'L4 flow', stage: world.stage.orcamento });
    const flow = rowOf(
      await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
        deal_ids: [a],
        to_stage_id: world.stage.flow,
      }),
    );
    expect(flow.riskLevel).toBe(4);
    expect(previewOf(flow).before_after.map((r) => r.after)).toContain(
      'Ao entrar em Nutrição, a automação dispara o flow configurado para o cliente',
    );
    const b = await seedDeal(world, { title: 'L4 conversão', stage: world.stage.conversao });
    const conv = rowOf(
      await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
        deal_ids: [b],
        to_stage_id: world.stage.orcamento,
      }),
    );
    expect(conv.riskLevel).toBe(4);
    expect(previewOf(conv).before_after.map((r) => r.after)).toContain(
      "Ao sair de Pagamento, a automação registra a conversão 'purchase' nas plataformas de anúncio",
    );
  });

  it('notify_members no destino → nível 3 com 1 alvo e a pessoa em "quem é avisado"', async () => {
    const id = await seedDeal(world, { title: 'L3 avisar', stage: world.stage.orcamento });
    const row = rowOf(
      await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
        deal_ids: [id],
        to_stage_id: world.stage.avisar,
      }),
    );
    expect(row.riskLevel).toBe(3);
    expect(row.status).toBe('proposed');
    expect(previewOf(row).impact.notified_members).toEqual([
      { member_id: world.paula, name: 'Paula Gestora' },
    ]);
  });

  it('requiresApproval no destino → item skipped_policy; nada se move', async () => {
    const a = await seedDeal(world, { title: 'Aprovação A', stage: world.stage.reativacao });
    const b = await seedDeal(world, { title: 'Aprovação B', stage: world.stage.reativacao });
    const row = rowOf(
      await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
        deal_ids: [a, b],
        to_stage_id: world.stage.aprovacao,
      }),
    );
    expect(previewOf(row).before_after.map((r) => r.label)).toContain('Regra do Pipeline');
    const done = await confirmAndRun(world, memberOf(world, 'OWNER'), row.id);
    expect(done.proposal.status).toBe('failed');
    expect(done.items.map((i) => [i.status, i.errorCode])).toEqual([
      ['skipped_policy', 'requires_approval'],
      ['skipped_policy', 'requires_approval'],
    ]);
    expect(await stageOf(a)).toBe(world.stage.reativacao);
  });
});

describe('prévia, avisos, escopo e entre empresas', () => {
  it('Δ na previsão com a p(estágio) do forecast_revenue e aviso ao responsável por nota', async () => {
    // Histórico: 10 decididos que passaram por Reativação (2 ganhos), 10 por Orçamento (8 ganhos).
    const db = getDb();
    for (let i = 0; i < 10; i++) {
      for (const [stage, wonUntil] of [
        [world.stage.reativacao, 2],
        [world.stage.orcamento, 8],
      ] as const) {
        await db.insert(schema.deals).values({
          workspaceId: ws(),
          pipelineId: world.pipeline,
          stageId: stage,
          contactId: world.contact.joao,
          title: `Histórico ${stage.slice(0, 4)} ${i}`,
          valueCents: 1000,
          closedAt: new Date(Date.now() - 86_400_000),
          closedWon: i < wonUntil,
        });
      }
    }
    const agentB = world.agentB;
    const id = await seedDeal(world, {
      title: 'Com aviso',
      stage: world.stage.orcamento,
      owner: agentB,
      conv: world.conv.agentB,
      cents: 1_000_000,
    });
    const row = rowOf(
      await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
        deal_ids: [id],
        to_stage_id: world.stage.reativacao,
        notify_owners: true,
      }),
    );
    // R$ 10.000 × (0,2 − 0,8) = −6.000.
    expect(previewOf(row).impact.forecast_delta_brl).toBe(-6000);
    expect(previewOf(row).impact.notified_members).toEqual([
      { member_id: agentB, name: 'Bruno Atendente' },
    ]);
    expect(row.riskLevel).toBe(3);
    world.mentions.length = 0;
    const done = await confirmAndRun(world, memberOf(world, 'OWNER'), row.id);
    expect(done.proposal.status).toBe('completed');
    const noteId = done.items[0]?.undoPayload?.['note_id'];
    expect(typeof noteId).toBe('string');
    const [note] = await db
      .select({ body: schema.conversationNotes.body, mentions: schema.conversationNotes.mentions })
      .from(schema.conversationNotes)
      .where(eq(schema.conversationNotes.id, String(noteId)));
    expect(note?.body.startsWith('Movido pelo Copiloto a pedido de OWNER')).toBe(true);
    expect(note?.mentions).toEqual([agentB]);
    expect(world.mentions.map((m) => m.memberId)).toEqual([agentB]);
    // Desfazer apaga a nota de aviso.
    await undo(world, memberOf(world, 'OWNER'), row.id);
    const gone = await db
      .select()
      .from(schema.conversationNotes)
      .where(eq(schema.conversationNotes.id, String(noteId)));
    expect(gone).toHaveLength(0);
  });

  it('AGENT só move o que vê: negócio de colega some como not_found', async () => {
    const agent = memberOf(world, 'AGENT');
    const mine = await seedDeal(world, {
      title: 'Do agente',
      stage: world.stage.orcamento,
      owner: agent,
    });
    const peer = await seedDeal(world, {
      title: 'Do colega',
      stage: world.stage.orcamento,
      owner: world.agentB,
    });
    const outcome = await propose(world, agent, moveDealsExecutor, {
      deal_ids: [mine, peer],
      to_stage_id: world.stage.reativacao,
    });
    expect(outcome.kind).toBe('executed');
    if (outcome.kind !== 'executed') return;
    expect(outcome.dropped).toEqual([{ id: peer, reason: 'not_found' }]);
    expect(outcome.items.map((i) => i.targetId)).toEqual([mine]);
    expect(await stageOf(mine)).toBe(world.stage.reativacao);
    expect(await stageOf(peer)).toBe(world.stage.orcamento);
  });

  it('entre empresas: id de outro workspace = not_found; nada é tocado', async () => {
    const outcome = await propose(world, memberOf(world, 'OWNER'), moveDealsExecutor, {
      deal_ids: [world.otherIds.deal],
      to_stage_id: world.stage.reativacao,
    });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('scope');
    expect(outcome.dropped).toEqual([{ id: world.otherIds.deal, reason: 'not_found' }]);
  });
});
