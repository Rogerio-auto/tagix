/**
 * Mundo semeado dos testes de uso, alerta e insights do Copiloto (F73-S15), no Postgres de dev.
 *
 * Instante fixo `USAGE_NOW` (2026-10-17 12:00Z); todos os números esperados dos testes saem
 * daqui, de conta feita à mão (ver o comentário de cada bloco):
 *
 *   Turnos     T1 ADMIN  concluído 10-03  US$ 0,50
 *              T2 ADMIN  concluído 10-10  US$ 1,25  (format_fallback)
 *              T3 OWNER  concluído 10-17  US$ 0,75
 *              T4 OWNER  cancelado 10-17  sem custo gravado
 *              T5 AGENT  concluído 09-20  US$ 9,00  (setembro: fora do mês, dentro de 30 dias)
 *              + linha de uso da superfície `agent` de US$ 5,00 em outubro (não é do Copiloto)
 *   Propostas  P1 nível 2 concluída · P2 nível 3 concluída · P3 nível 3 desfeita · P4 nível 3
 *              cancelada · P5 nível 3 expirada · P6 nível 3 aberta · P7 nível 4 bloqueada ·
 *              P8 piloto nível 3 concluída · P9 piloto nível 3 desfeita
 *   Piloto     estágio A: 2 aprovadas + 1 rejeitada (+ 1 pendente, 1 expirada, 1 aprovada há 40 dias)
 *              estágio B: 1 rejeitada
 *   Briefings  3 `ready` (1 visto no próprio dia) + 1 `empty`
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { seedCopilotWorkspace, type SeededWorkspace } from '../identity/test-fixtures';

export const USAGE_NOW = new Date('2026-10-17T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface UsageWorld extends SeededWorkspace {
  readonly stageA: string;
  readonly stageB: string;
}

interface TurnSeed {
  readonly role: Role;
  readonly status: 'completed' | 'cancelled';
  readonly startedAt: Date;
  readonly costUsd?: string;
  readonly formatFallback?: boolean;
}

export async function seedUsageWorld(): Promise<UsageWorld> {
  const base = await seedCopilotWorkspace({ label: 'Usage' });
  const db = getDb();
  const ws = base.workspaceId;
  await db
    .update(schema.workspaces)
    .set({ timezone: 'America/Sao_Paulo' })
    .where(eq(schema.workspaces.id, ws));

  const sessions = new Map<Role, string>();
  const sessionOf = async (role: Role): Promise<string> => {
    const cached = sessions.get(role);
    if (cached) return cached;
    const [s] = await db
      .insert(schema.copilotSessions)
      .values({ workspaceId: ws, memberId: base.members[role].id, origin: 'bubble' })
      .returning();
    if (!s) throw new Error('seed: sessão');
    sessions.set(role, s.id);
    return s.id;
  };

  const turn = async (t: TurnSeed): Promise<string> => {
    const [row] = await db
      .insert(schema.copilotTurns)
      .values({
        workspaceId: ws,
        memberId: base.members[t.role].id,
        sessionId: await sessionOf(t.role),
        status: t.status,
        grantNonce: `nonce-${randomUUID()}`,
        expiresAt: new Date(t.startedAt.getTime() + 2 * 60_000),
        maxToolCalls: 16,
        startedAt: t.startedAt,
        completedAt: new Date(t.startedAt.getTime() + 2_000),
        costUsd: t.costUsd ?? '0',
      })
      .returning();
    if (!row) throw new Error('seed: turno');
    if (t.costUsd !== undefined) {
      await db.insert(schema.llmUsageLogs).values({
        workspaceId: ws,
        requestType: 'chat',
        model: 'openai/gpt-4.1-mini',
        costUsd: t.costUsd,
        surface: 'copilot',
        copilotTurnId: row.id,
        createdAt: new Date(t.startedAt.getTime() + 2_000),
        ...(t.formatFallback ? { metadata: { format_fallback: true } } : {}),
      });
    }
    return row.id;
  };

  await turn({
    role: 'ADMIN',
    status: 'completed',
    startedAt: new Date('2026-10-03T10:00:00Z'),
    costUsd: '0.50',
  });
  await turn({
    role: 'ADMIN',
    status: 'completed',
    startedAt: new Date('2026-10-10T10:00:00Z'),
    costUsd: '1.25',
    formatFallback: true,
  });
  await turn({
    role: 'OWNER',
    status: 'completed',
    startedAt: new Date('2026-10-17T09:00:00Z'),
    costUsd: '0.75',
  });
  await turn({ role: 'OWNER', status: 'cancelled', startedAt: new Date('2026-10-17T10:00:00Z') });
  await turn({
    role: 'AGENT',
    status: 'completed',
    startedAt: new Date('2026-09-20T10:00:00Z'),
    costUsd: '9.00',
  });
  await db.insert(schema.llmUsageLogs).values({
    workspaceId: ws,
    requestType: 'chat',
    model: 'openai/gpt-4o-mini',
    costUsd: '5.00',
    surface: 'agent',
    createdAt: new Date('2026-10-05T10:00:00Z'),
  });

  // Propostas.
  const requester = base.members.AGENT.id;
  const created = new Date('2026-10-05T10:00:00Z');
  const proposal = async (v: {
    risk: 1 | 2 | 3 | 4;
    status: (typeof schema.copilotActionProposals.$inferInsert)['status'];
    source?: 'copilot' | 'autopilot';
    confirmed?: boolean;
    executed?: boolean;
    undone?: boolean;
    open?: boolean;
    blocked?: boolean;
  }): Promise<void> => {
    await db.insert(schema.copilotActionProposals).values({
      workspaceId: ws,
      source: v.source ?? 'copilot',
      capability: 'deal.move',
      riskLevel: v.risk,
      status: v.status,
      requestedByMemberId: requester,
      summary: 'Mover negócios',
      createdAt: created,
      ...(v.open || v.status === 'expired'
        ? { expiresAt: new Date(USAGE_NOW.getTime() + (v.open ? DAY : -DAY)) }
        : {}),
      ...(v.blocked ? { blockedReason: 'role' as const } : {}),
      ...(v.confirmed ? { confirmedAt: created } : {}),
      ...(v.executed ? { executedAt: created } : {}),
      ...(v.undone ? { undoneAt: created } : {}),
    });
  };
  await proposal({ risk: 2, status: 'completed', executed: true });
  await proposal({ risk: 3, status: 'completed', confirmed: true, executed: true });
  await proposal({ risk: 3, status: 'undone', confirmed: true, executed: true, undone: true });
  await proposal({ risk: 3, status: 'cancelled' });
  await proposal({ risk: 3, status: 'expired' });
  await proposal({ risk: 3, status: 'proposed', open: true });
  await proposal({ risk: 4, status: 'blocked', blocked: true });
  await proposal({
    risk: 3,
    status: 'completed',
    source: 'autopilot',
    confirmed: true,
    executed: true,
  });
  await proposal({
    risk: 3,
    status: 'undone',
    source: 'autopilot',
    confirmed: true,
    executed: true,
    undone: true,
  });

  // Piloto: funil, estágios, negócios e sugestões.
  const [pipeline] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: ws, name: 'Funil', isDefault: true })
    .returning();
  if (!pipeline) throw new Error('seed: pipeline');
  const stages = await db
    .insert(schema.stages)
    .values([
      { workspaceId: ws, pipelineId: pipeline.id, name: 'Estágio A', position: 0 },
      { workspaceId: ws, pipelineId: pipeline.id, name: 'Estágio B', position: 1 },
      { workspaceId: ws, pipelineId: pipeline.id, name: 'Destino', position: 2 },
    ])
    .returning();
  const byName = new Map(stages.map((s) => [s.name, s.id]));
  const stageA = byName.get('Estágio A');
  const stageB = byName.get('Estágio B');
  const dest = byName.get('Destino');
  if (!stageA || !stageB || !dest) throw new Error('seed: estágios');
  const [contact] = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws, displayName: 'Cliente Teste', phone: '+5511900000099' })
    .returning();
  if (!contact) throw new Error('seed: contato');
  const suggestion = async (
    from: string,
    status: (typeof schema.copilotSuggestions.$inferInsert)['status'],
    decidedAt: Date | null,
  ): Promise<void> => {
    const [deal] = await db
      .insert(schema.deals)
      .values({
        workspaceId: ws,
        pipelineId: pipeline.id,
        stageId: from,
        contactId: contact.id,
        ownerId: base.members.AGENT.id,
        title: 'Negócio',
        valueCents: 1000,
      })
      .returning();
    if (!deal) throw new Error('seed: negócio');
    await db.insert(schema.copilotSuggestions).values({
      workspaceId: ws,
      dealId: deal.id,
      fromStageId: from,
      toStageId: dest,
      reasonCode: 'idle',
      reasonText: 'Parado há 10 dias',
      confidence: 'high',
      status,
      decidedAt,
      createdAt: new Date(USAGE_NOW.getTime() - 41 * DAY),
    });
  };
  const decided = new Date(USAGE_NOW.getTime() - 2 * DAY);
  await suggestion(stageA, 'approved', decided);
  await suggestion(stageA, 'approved', decided);
  await suggestion(stageA, 'rejected', decided);
  await suggestion(stageA, 'pending', null);
  await suggestion(stageA, 'expired', null);
  await suggestion(stageA, 'approved', new Date(USAGE_NOW.getTime() - 40 * DAY));
  await suggestion(stageB, 'rejected', decided);

  // Briefings (fuso de São Paulo, UTC-3).
  const briefing = async (
    role: Role,
    forDate: string,
    status: 'ready' | 'empty',
    seenAt: Date | null,
  ): Promise<void> => {
    await db.insert(schema.copilotBriefings).values({
      workspaceId: ws,
      memberId: base.members[role].id,
      forDate,
      dataAsOf: USAGE_NOW,
      items: [],
      status,
      seenAt,
    });
  };
  await briefing('ADMIN', '2026-10-15', 'ready', new Date('2026-10-15T14:00:00Z'));
  await briefing('OWNER', '2026-10-16', 'ready', new Date('2026-10-17T14:00:00Z'));
  await briefing('AGENT', '2026-10-17', 'ready', null);
  await briefing('SUPERVISOR', '2026-10-17', 'empty', null);

  return { ...base, stageA, stageB };
}
