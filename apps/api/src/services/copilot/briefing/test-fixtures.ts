/**
 * Semeadura dos testes de integração do briefing (F73-S12) contra o Postgres de dev.
 *
 * Só para testes. Relógio fixo: `BRIEFING_NOW` = 2026-10-17T13:00:00Z, workspace em UTC (data
 * local 2026-10-17). TUDO é semeado relativo a esse instante: nada depende do relógio do host.
 *
 * Mundo (funil F, estágios Novo · Orçamento enviado · Reativação):
 *
 *   negócios abertos                       dono      estágio     valor      parado
 *     A1                                   agente A  Orçamento   R$ 10.000  10 dias
 *     A2                                   agente A  Orçamento   R$  5.000   4 dias
 *     B1                                   agente B  Orçamento   R$ 20.000   8 dias
 *     B2                                   agente B  Novo        R$  3.000   1 dia (não parado)
 *     O1                                   OWNER     Novo        R$  2.000   5 dias
 *   ganhos (90 dias)  W1 R$ 4.000 (agente B, há 10 d) · W2 R$ 2.000 (agente A, há 20 d)
 *   conversas esperando (aberta, última msg do contato): 2 do agente A (há 30 min),
 *                                                        1 do agente B (há 90 min)
 *   agenda de hoje (calendário da empresa): E1 15:00Z → A1 · E2 20:00Z → B1 (agendados);
 *                                           E3 confirmado · E4 amanhã · E5 já passou (fora)
 *   piloto: estágio Orçamento em `daily_approval`; sugestão pendente para A1
 *   campanha "Clareamento": rodando, saúde crítica, 100 destinatários, 60 enviadas, 12 falhas
 *
 * Números esperados (OWNER, ticket médio 3.000 = (4.000 + 2.000) / 2):
 *   deals_idle Orçamento  35.000 × 1,25 = 43.750   (3 negócios, mais antigo 10 dias)
 *   events_today          30.000 × 1,35 = 40.500   (2 compromissos, 1º em 2 h)
 *   leads_waiting          9.000 × 1,25 = 11.250   (3 conversas, a mais antiga há 90 min)
 *   autopilot_pending     10.000 × 0,70 =  7.000
 *   deals_idle Novo        2.000 × 1,00 =  2.000
 *   campaign_issue         1.680 × 0,75 =  1.260   (28 pendentes × 3.000 × 2%)
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { copilotAutopilotRepo, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import { seedCopilotWorkspace, type SeededWorkspace } from '../identity/test-fixtures';

export const BRIEFING_NOW = new Date('2026-10-17T13:00:00.000Z');
export const BRIEFING_DATE = '2026-10-17';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number): Date => new Date(BRIEFING_NOW.getTime() - ms);
const ahead = (ms: number): Date => new Date(BRIEFING_NOW.getTime() + ms);

export interface BriefingWorld {
  readonly ws: SeededWorkspace;
  readonly workspaceId: string;
  readonly agentA: string;
  readonly agentB: string;
  readonly pipelineId: string;
  readonly stage: { readonly novo: string; readonly orcamento: string; readonly reativacao: string };
  readonly deal: Record<'A1' | 'A2' | 'B1' | 'B2' | 'O1', string>;
  readonly event: Record<'E1' | 'E2' | 'E3', string>;
  readonly campaignId: string;
  /** Membro por papel (o AGENT é o "agente A"). */
  readonly member: (role: Role) => string;
  cleanup(): Promise<void>;
}

export interface SeedOptions {
  /** Só o workspace e os membros, sem negócios, conversas, agenda nem campanha. */
  readonly empty?: boolean;
  readonly label?: string;
}

export async function seedBriefingWorld(options: SeedOptions = {}): Promise<BriefingWorld> {
  const ws = await seedCopilotWorkspace({ label: options.label ?? 'Briefing' });
  const workspaceId = ws.workspaceId;
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  await db
    .update(schema.workspaces)
    .set({ timezone: 'UTC', locale: 'pt-BR' })
    .where(eq(schema.workspaces.id, workspaceId));

  const [b] = await db
    .insert(schema.members)
    .values({
      workspaceId,
      authUserId: randomUUID(),
      email: `briefing-agent-b-${sfx}@t.local`,
      name: 'Agente B',
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!b) throw new Error('seed: agente B');
  const agentA = ws.members.AGENT.id;
  const agentB = b.id;

  const base = {
    ws,
    workspaceId,
    agentA,
    agentB,
    member: (role: Role) => ws.members[role].id,
    cleanup: () => ws.cleanup(),
  };
  if (options.empty) {
    return {
      ...base,
      pipelineId: '',
      stage: { novo: '', orcamento: '', reativacao: '' },
      deal: { A1: '', A2: '', B1: '', B2: '', O1: '' },
      event: { E1: '', E2: '', E3: '' },
      campaignId: '',
    };
  }

  const [pipeline] = await db
    .insert(schema.pipelines)
    .values({ workspaceId, name: 'Funil', isDefault: true })
    .returning();
  if (!pipeline) throw new Error('seed: pipeline');
  const stageRows = await db
    .insert(schema.stages)
    .values([
      { workspaceId, pipelineId: pipeline.id, name: 'Novo', position: 0 },
      { workspaceId, pipelineId: pipeline.id, name: 'Orçamento enviado', position: 1 },
      { workspaceId, pipelineId: pipeline.id, name: 'Reativação', position: 2 },
    ])
    .returning();
  const [novo, orcamento, reativacao] = stageRows.sort((x, y) => x.position - y.position);
  if (!novo || !orcamento || !reativacao) throw new Error('seed: estágios');

  const [contact] = await db
    .insert(schema.contacts)
    .values({ workspaceId, displayName: 'Cliente Teste', phone: '+5511900000001' })
    .returning();
  if (!contact) throw new Error('seed: contato');

  const mkDeal = async (v: {
    title: string;
    owner: string;
    stage: string;
    cents: number;
    updatedAt?: Date;
    closedAt?: Date;
    won?: boolean;
  }): Promise<string> => {
    const [d] = await db
      .insert(schema.deals)
      .values({
        workspaceId,
        pipelineId: pipeline.id,
        stageId: v.stage,
        contactId: contact.id,
        ownerId: v.owner,
        title: v.title,
        valueCents: v.cents,
        createdAt: ago(60 * DAY),
        ...(v.updatedAt ? { updatedAt: v.updatedAt } : {}),
        ...(v.closedAt ? { closedAt: v.closedAt, closedWon: v.won ?? false } : {}),
      })
      .returning();
    if (!d) throw new Error('seed: negócio');
    return d.id;
  };
  const deal = {
    A1: await mkDeal({
      title: 'A1',
      owner: agentA,
      stage: orcamento.id,
      cents: 1_000_000,
      updatedAt: ago(10 * DAY + HOUR),
    }),
    A2: await mkDeal({
      title: 'A2',
      owner: agentA,
      stage: orcamento.id,
      cents: 500_000,
      updatedAt: ago(4 * DAY + HOUR),
    }),
    B1: await mkDeal({
      title: 'B1',
      owner: agentB,
      stage: orcamento.id,
      cents: 2_000_000,
      updatedAt: ago(8 * DAY + HOUR),
    }),
    B2: await mkDeal({
      title: 'B2',
      owner: agentB,
      stage: novo.id,
      cents: 300_000,
      updatedAt: ago(1 * DAY),
    }),
    O1: await mkDeal({
      title: 'O1',
      owner: ws.members.OWNER.id,
      stage: novo.id,
      cents: 200_000,
      updatedAt: ago(5 * DAY + HOUR),
    }),
  };
  await mkDeal({
    title: 'W1',
    owner: agentB,
    stage: orcamento.id,
    cents: 400_000,
    closedAt: ago(10 * DAY),
    won: true,
    updatedAt: ago(10 * DAY),
  });
  await mkDeal({
    title: 'W2',
    owner: agentA,
    stage: orcamento.id,
    cents: 200_000,
    closedAt: ago(20 * DAY),
    won: true,
    updatedAt: ago(20 * DAY),
  });

  // Conversas esperando resposta (a mesma régua do /api/dashboard/today).
  const [channel] = await db
    .insert(schema.channels)
    .values({
      workspaceId,
      provider: 'meta_whatsapp',
      name: `Canal ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  if (!channel) throw new Error('seed: canal');
  const mkConv = async (assignedTo: string, remote: string, lastAt: Date): Promise<void> => {
    await db.insert(schema.conversations).values({
      workspaceId,
      channelId: channel.id,
      contactId: contact.id,
      remoteId: `${remote}-${sfx}`,
      assignedTo,
      status: 'open',
      lastMessageFrom: 'contact',
      lastMessageAt: lastAt,
      lastMessagePreview: 'oi',
    });
  };
  await mkConv(agentA, 'a1', ago(30 * MIN));
  await mkConv(agentA, 'a2', ago(35 * MIN));
  await mkConv(agentB, 'b1', ago(90 * MIN));

  // Agenda de hoje no calendário da empresa (visível a todos os papéis).
  const [calendar] = await db
    .insert(schema.calendars)
    .values({ workspaceId, name: 'Empresa', type: 'workspace', timezone: 'UTC', isDefault: true })
    .returning();
  if (!calendar) throw new Error('seed: calendário');
  const mkEvent = async (v: {
    title: string;
    startAt: Date;
    status: string;
    dealId?: string;
  }): Promise<string> => {
    const [e] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        calendarId: calendar.id,
        title: v.title,
        startAt: v.startAt,
        endAt: new Date(v.startAt.getTime() + HOUR),
        status: v.status,
        contactId: contact.id,
        ...(v.dealId ? { dealId: v.dealId } : {}),
      })
      .returning();
    if (!e) throw new Error('seed: evento');
    return e.id;
  };
  const event = {
    E1: await mkEvent({ title: 'E1', startAt: ahead(2 * HOUR), status: 'scheduled', dealId: deal.A1 }),
    E2: await mkEvent({ title: 'E2', startAt: ahead(7 * HOUR), status: 'scheduled', dealId: deal.B1 }),
    E3: await mkEvent({ title: 'E3', startAt: ahead(3 * HOUR), status: 'confirmed', dealId: deal.A2 }),
  };
  await mkEvent({ title: 'E4 amanhã', startAt: ahead(20 * HOUR), status: 'scheduled' });
  await mkEvent({ title: 'E5 já passou', startAt: ago(2 * HOUR), status: 'scheduled' });

  // Piloto automático: estágio em aprovação diária, 1 sugestão pendente para A1.
  await withWorkspace(workspaceId, async (tx) => {
    await copilotAutopilotRepo.upsertRule(tx, {
      workspaceId,
      stageId: orcamento.id,
      mode: 'daily_approval',
      criteria: { idle_days: 3, target_stage_id: reativacao.id, require_last_outbound: false },
      memberId: ws.members.OWNER.id,
    });
    await copilotAutopilotRepo.insertSuggestionIfAbsent(tx, {
      workspaceId,
      dealId: deal.A1,
      fromStageId: orcamento.id,
      toStageId: reativacao.id,
      reasonCode: 'idle',
      reasonText: 'Sem resposta há 10 dias',
      confidence: 'high',
    });
  });

  // Campanha com problema.
  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      workspaceId,
      channelId: channel.id,
      name: 'Clareamento',
      type: 'broadcast',
      status: 'running',
    })
    .returning();
  if (!campaign) throw new Error('seed: campanha');
  await db.insert(schema.campaignMetrics).values({
    campaignId: campaign.id,
    workspaceId,
    totalRecipients: 100,
    messagesSent: 60,
    messagesFailed: 12,
    healthStatus: 'critical',
  });

  return {
    ...base,
    pipelineId: pipeline.id,
    stage: { novo: novo.id, orcamento: orcamento.id, reativacao: reativacao.id },
    deal,
    event,
    campaignId: campaign.id,
  };
}
