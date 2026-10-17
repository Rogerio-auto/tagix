/**
 * Semeadura e atalhos dos testes de integração das ações de CRM (F73-S08). Só para testes.
 *
 * Um workspace isolado (um membro por papel + "Paula Gestora" e um segundo atendente), canal,
 * departamento e time PRIVADO (o AGENT só vê as conversas dele), contatos, duas conversas, um
 * funil com estágios e automações, e um segundo workspace para os casos entre empresas.
 *
 * O motor roda com as dependências reais (`createProposalEngineDeps`) e efeitos externos
 * capturados: socket da proposta, notificação, `deal:*` (`setDealEventPublisher`) e menção de
 * nota (`setMentionPublisher`). Os hooks do seam de deals são os de produção
 * (`registerDealHooks`): `deal:stage_changed` + agendamento em `pending_automations`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { copilotProposalsRepo, getDb, schema, withWorkspace, type DbTx } from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  ProposalPreviewSchema,
  type ProposalPreview,
  type Role,
  type ServerToClientEvent,
} from '@hm/shared';
import {
  setMentionPublisher,
  type MentionRelayInput,
} from '../../../services/conversation-notes/create';
import { registerDealHooks } from '../../../services/deal-hooks';
import { setDealEventPublisher } from '../../../services/deal-events';
import {
  resolveCopilotPrincipal,
  type CopilotPrincipal,
} from '../../../services/copilot/identity/principal';
import {
  seedCopilotWorkspace,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import {
  AfterCommitQueue,
  confirmProposal,
  createExecutorRegistry,
  createProposalEngineDeps,
  drainProposalExecutions,
  proposeAction,
  undoProposal,
  type ProposalEngineDeps,
  type ProposeOutcome,
} from '../../../services/copilot/proposals';
import type { CapabilityExecutor } from '../core/executor-types';
import { executors } from './index';

type AutomationRule = schema.AutomationRule;

export const DAY = 24 * 60 * 60 * 1000;

export interface PublishedDealEvent {
  readonly event: ServerToClientEvent;
  readonly workspaceId: string;
  readonly data: Record<string, unknown>;
  /** Estágio do negócio lido por OUTRA conexão no momento da publicação (prova do pós-commit). */
  readonly committedStageId: string | null;
}

export interface CrmWorld {
  readonly ws: SeededWorkspace;
  readonly other: SeededWorkspace;
  readonly paula: string;
  readonly agentB: string;
  readonly pipeline: string;
  readonly stage: {
    readonly orcamento: string;
    readonly reativacao: string;
    readonly whatsapp: string;
    readonly flow: string;
    readonly avisar: string;
    readonly aprovacao: string;
    readonly conversao: string;
  };
  readonly contact: { readonly maria: string; readonly joao: string; readonly ana: string };
  readonly conv: { readonly agent: string; readonly agentB: string };
  readonly tag: { readonly vip: string; readonly frio: string };
  readonly calendar: { readonly workspace: string; readonly paulaPersonal: string };
  readonly otherIds: {
    readonly deal: string;
    readonly contact: string;
    readonly conv: string;
    readonly calendar: string;
  };
  readonly dealEvents: PublishedDealEvent[];
  readonly mentions: MentionRelayInput[];
  readonly deps: ProposalEngineDeps;
  cleanup(): Promise<void>;
}

function rule(
  partial: Pick<AutomationRule, 'trigger' | 'action' | 'config'> & Partial<AutomationRule>,
): AutomationRule {
  return { id: randomUUID(), delaySeconds: 0, enabled: true, ...partial };
}

export async function seedCrmWorld(label: string): Promise<CrmWorld> {
  const ws = await seedCopilotWorkspace({ label });
  const other = await seedCopilotWorkspace({ label: `${label} outro` });
  const db = getDb();
  const w = ws.workspaceId;
  const sfx = randomUUID().slice(0, 8);

  const [paula] = await db
    .insert(schema.members)
    .values({
      workspaceId: w,
      authUserId: randomUUID(),
      email: `paula-${sfx}@t.local`,
      name: 'Paula Gestora',
      role: 'SUPERVISOR',
      status: 'active',
    })
    .returning();
  const [agentB] = await db
    .insert(schema.members)
    .values({
      workspaceId: w,
      authUserId: randomUUID(),
      email: `bruno-${sfx}@t.local`,
      name: 'Bruno Atendente',
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!paula || !agentB) throw new Error('seed: membros');

  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId: w,
      provider: 'meta_whatsapp',
      name: `Canal ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  const [dept] = await db
    .insert(schema.departments)
    .values({ workspaceId: w, name: `Dept ${sfx}` })
    .returning();
  if (!ch || !dept) throw new Error('seed: canal');
  const [team] = await db
    .insert(schema.teams)
    .values({
      workspaceId: w,
      departmentId: dept.id,
      name: `Time ${sfx}`,
      peerVisibility: 'private',
    })
    .returning();
  if (!team) throw new Error('seed: time');
  await db.insert(schema.teamMembers).values([
    { workspaceId: w, teamId: team.id, memberId: ws.members.AGENT.id, role: 'member' },
    { workspaceId: w, teamId: team.id, memberId: agentB.id, role: 'member' },
  ]);

  const contactRows = await db
    .insert(schema.contacts)
    .values([
      {
        workspaceId: w,
        displayName: 'Maria Souza',
        phone: `+55119${sfx.replace(/\D/g, '1').slice(0, 4)}0001`,
        language: 'pt-BR',
      },
      {
        workspaceId: w,
        displayName: 'João Lima',
        phone: `+55119${sfx.replace(/\D/g, '2').slice(0, 4)}0002`,
      },
      {
        workspaceId: w,
        displayName: 'Ana Prado',
        phone: `+55119${sfx.replace(/\D/g, '3').slice(0, 4)}0003`,
      },
    ])
    .returning();
  const [maria, joao, ana] = contactRows;
  if (!maria || !joao || !ana) throw new Error('seed: contatos');

  const mkConv = async (assignedTo: string, remote: string): Promise<string> => {
    const [c] = await db
      .insert(schema.conversations)
      .values({
        workspaceId: w,
        channelId: ch.id,
        contactId: maria.id,
        remoteId: `${remote}-${sfx}`,
        departmentId: dept.id,
        teamId: team.id,
        assignedTo,
      })
      .returning();
    if (!c) throw new Error('seed: conversa');
    return c.id;
  };
  const convAgent = await mkConv(ws.members.AGENT.id, 'ca');
  const convAgentB = await mkConv(agentB.id, 'cb');

  const [vip] = await db.insert(schema.tags).values({ workspaceId: w, name: 'vip' }).returning();
  const [frio] = await db.insert(schema.tags).values({ workspaceId: w, name: 'frio' }).returning();
  if (!vip || !frio) throw new Error('seed: tags');

  const [pipeline] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: w, name: 'Funil', isDefault: true })
    .returning();
  if (!pipeline) throw new Error('seed: funil');
  const stageRows = await db
    .insert(schema.stages)
    .values([
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Orçamento enviado',
        position: 0,
        automationRules: [
          rule({
            trigger: 'on_enter',
            action: 'add_tag',
            config: { kind: 'add_tag', tagId: frio.id },
            delaySeconds: 7200,
          }),
        ],
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Reativação',
        position: 1,
        automationRules: [
          rule({
            trigger: 'on_enter',
            action: 'add_tag',
            config: { kind: 'add_tag', tagId: vip.id },
            delaySeconds: 3600,
          }),
          rule({
            trigger: 'on_exit',
            action: 'remove_tag',
            config: { kind: 'remove_tag', tagId: vip.id },
          }),
          rule({
            trigger: 'on_enter',
            action: 'send_message',
            enabled: false,
            config: {
              kind: 'send_message',
              templateName: 'desligada',
              languageCode: 'pt_BR',
              channelId: ch.id,
            },
          }),
        ],
        transitionRules: { allowedFromStageIds: [] },
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Retomada por WhatsApp',
        position: 2,
        automationRules: [
          rule({
            trigger: 'on_enter',
            action: 'send_message',
            config: {
              kind: 'send_message',
              templateName: 'retomada',
              languageCode: 'pt_BR',
              channelId: ch.id,
            },
          }),
        ],
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Nutrição',
        position: 3,
        automationRules: [
          rule({
            trigger: 'on_enter',
            action: 'trigger_flow',
            config: { kind: 'trigger_flow', flowId: randomUUID() },
          }),
        ],
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Avisar gestão',
        position: 4,
        automationRules: [
          rule({
            trigger: 'on_enter',
            action: 'notify_members',
            config: {
              kind: 'notify_members',
              memberIds: [paula.id],
              title: 'Entrou',
              body: 'Veja',
            },
          }),
        ],
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Contrato',
        position: 5,
        transitionRules: { requiresApproval: true },
      },
      {
        workspaceId: w,
        pipelineId: pipeline.id,
        name: 'Pagamento',
        position: 6,
        automationRules: [
          rule({
            trigger: 'on_exit',
            action: 'register_conversion',
            config: {
              kind: 'register_conversion',
              conversionTypeKey: 'purchase',
              valueFrom: 'deal',
            },
          }),
        ],
      },
    ])
    .returning();
  const byName = new Map(stageRows.map((s) => [s.name, s.id]));
  const sid = (name: string): string => {
    const id = byName.get(name);
    if (!id) throw new Error(`seed: estágio ${name}`);
    return id;
  };
  // Só se ENTRA em "Orçamento enviado" vindo de "Contrato": a volta do desfazer (de Reativação)
  // seria recusada como transição comum; como restauração de estado, passa.
  await db
    .update(schema.stages)
    .set({ transitionRules: { allowedFromStageIds: [sid('Contrato')] } })
    .where(eq(schema.stages.id, sid('Orçamento enviado')));

  const [wsCal] = await db
    .insert(schema.calendars)
    .values({ workspaceId: w, name: 'Empresa', type: 'workspace', isDefault: true })
    .returning();
  const [paulaCal] = await db
    .insert(schema.calendars)
    .values({ workspaceId: w, name: 'Agenda da Paula', type: 'personal', ownerId: paula.id })
    .returning();
  if (!wsCal || !paulaCal) throw new Error('seed: agendas');

  // Outro workspace: um de cada (para os casos entre empresas).
  const o = other.workspaceId;
  const [oContact] = await db
    .insert(schema.contacts)
    .values({ workspaceId: o, displayName: 'Outra Empresa' })
    .returning();
  const [oPipe] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: o, name: 'Funil O' })
    .returning();
  if (!oContact || !oPipe) throw new Error('seed: outro');
  const [oStage] = await db
    .insert(schema.stages)
    .values({ workspaceId: o, pipelineId: oPipe.id, name: 'Novo', position: 0 })
    .returning();
  const [oCh] = await db
    .insert(schema.channels)
    .values({
      workspaceId: o,
      provider: 'meta_whatsapp',
      name: `O ${sfx}`,
      phoneNumberId: `opn-${sfx}`,
      wabaId: `owaba-${sfx}`,
    })
    .returning();
  if (!oStage || !oCh) throw new Error('seed: outro estágio');
  const [oDeal] = await db
    .insert(schema.deals)
    .values({
      workspaceId: o,
      pipelineId: oPipe.id,
      stageId: oStage.id,
      contactId: oContact.id,
      title: 'Alheio',
      valueCents: 100,
    })
    .returning();
  const [oConv] = await db
    .insert(schema.conversations)
    .values({ workspaceId: o, channelId: oCh.id, contactId: oContact.id, remoteId: `o-${sfx}` })
    .returning();
  const [oCal] = await db
    .insert(schema.calendars)
    .values({ workspaceId: o, name: 'Empresa O', type: 'workspace' })
    .returning();
  if (!oDeal || !oConv || !oCal) throw new Error('seed: outro negócio');

  const dealEvents: PublishedDealEvent[] = [];
  setDealEventPublisher({
    async publish(event, workspaceId, data) {
      const d = data as Record<string, unknown>;
      const dealId = typeof d['dealId'] === 'string' ? d['dealId'] : null;
      let committedStageId: string | null = null;
      if (dealId) {
        const [row] = await getDb()
          .select({ stageId: schema.deals.stageId })
          .from(schema.deals)
          .where(eq(schema.deals.id, dealId));
        committedStageId = row?.stageId ?? null;
      }
      dealEvents.push({ event, workspaceId, data: d, committedStageId });
    },
  });
  const mentions: MentionRelayInput[] = [];
  setMentionPublisher(async (m) => {
    mentions.push(m);
  });
  registerDealHooks();

  const deps = createProposalEngineDeps({
    executors: createExecutorRegistry(executors),
    emit: async () => undefined,
    notify: async () => undefined,
    logger: createLogger('error', { svc: '@hm/api', component: 'act-crm-test' }),
    progressThrottleMs: 0,
  });

  return {
    ws,
    other,
    paula: paula.id,
    agentB: agentB.id,
    pipeline: pipeline.id,
    stage: {
      orcamento: sid('Orçamento enviado'),
      reativacao: sid('Reativação'),
      whatsapp: sid('Retomada por WhatsApp'),
      flow: sid('Nutrição'),
      avisar: sid('Avisar gestão'),
      aprovacao: sid('Contrato'),
      conversao: sid('Pagamento'),
    },
    contact: { maria: maria.id, joao: joao.id, ana: ana.id },
    conv: { agent: convAgent, agentB: convAgentB },
    tag: { vip: vip.id, frio: frio.id },
    calendar: { workspace: wsCal.id, paulaPersonal: paulaCal.id },
    otherIds: { deal: oDeal.id, contact: oContact.id, conv: oConv.id, calendar: oCal.id },
    dealEvents,
    mentions,
    deps,
    async cleanup() {
      await drainProposalExecutions();
      setDealEventPublisher(null);
      setMentionPublisher(null);
      await ws.cleanup();
      await other.cleanup();
    },
  };
}

/** Cria um negócio no funil principal. */
export async function seedDeal(
  world: CrmWorld,
  v: {
    readonly title: string;
    readonly stage: string;
    readonly owner?: string | null;
    readonly cents?: number;
    readonly contact?: string;
    readonly conv?: string | null;
    readonly idleDays?: number;
  },
): Promise<string> {
  const updatedAt = new Date(Date.now() - (v.idleDays ?? 0) * DAY);
  const [d] = await getDb()
    .insert(schema.deals)
    .values({
      workspaceId: world.ws.workspaceId,
      pipelineId: world.pipeline,
      stageId: v.stage,
      contactId: v.contact ?? world.contact.maria,
      conversationId: v.conv ?? null,
      ownerId: v.owner === undefined ? world.ws.members.OWNER.id : v.owner,
      title: v.title,
      valueCents: v.cents ?? 100_000,
      createdAt: updatedAt,
      updatedAt,
    })
    .returning();
  if (!d) throw new Error('seed: negócio');
  return d.id;
}

export function memberOf(world: CrmWorld, role: Role): string {
  return world.ws.members[role].id;
}

export async function principalOf(
  tx: DbTx,
  workspaceId: string,
  memberId: string,
): Promise<CopilotPrincipal> {
  const p = await resolveCopilotPrincipal(tx, { workspaceId, memberId });
  if (!p) throw new Error('principal');
  return p;
}

/** Propor como o callback faria (fila pós-commit drenada só depois do commit). */
export async function propose(
  world: CrmWorld,
  memberId: string,
  executor: CapabilityExecutor,
  args: unknown,
  extra: { readonly turnTainted?: boolean; readonly workspaceId?: string } = {},
): Promise<ProposeOutcome> {
  const workspaceId = extra.workspaceId ?? world.ws.workspaceId;
  const queue = new AfterCommitQueue();
  const outcome = await withWorkspace(workspaceId, async (tx) =>
    proposeAction(
      world.deps,
      {
        tx,
        principal: await principalOf(tx, workspaceId, memberId),
        source: 'copilot',
        turnId: null,
        sessionId: null,
        ...(extra.turnTainted ? { turnTainted: true } : {}),
        afterCommit: (fn) => queue.push(fn),
      },
      executor,
      args,
    ),
  );
  await queue.drain(world.deps.logger);
  return outcome;
}

export function rowOf(outcome: ProposeOutcome): Extract<ProposeOutcome, { row: unknown }>['row'] {
  if (!('row' in outcome)) throw new Error(`sem proposta: ${outcome.kind}`);
  return outcome.row;
}

/** Prévia gravada, validada contra o contrato. */
export function previewOf(row: { readonly preview: unknown }): ProposalPreview {
  return ProposalPreviewSchema.parse(row.preview);
}

/** Confirma (com "Revisei" quando nível 4) e espera a execução. */
export async function confirmAndRun(world: CrmWorld, memberId: string, proposalId: string) {
  const loaded = await load(world, proposalId);
  const out = await withWorkspace(world.ws.workspaceId, async (tx) =>
    confirmProposal(
      world.deps,
      tx,
      await principalOf(tx, world.ws.workspaceId, memberId),
      proposalId,
      {
        idempotencyKey: randomUUID(),
        version: loaded.proposal.version,
        acknowledged: loaded.proposal.riskLevel === 4,
      },
    ),
  );
  if (!out.ok) throw new Error(`confirm: ${out.error}`);
  if (out.start) await out.start();
  return load(world, proposalId);
}

export async function undo(world: CrmWorld, memberId: string, proposalId: string) {
  const viewer = await withWorkspace(world.ws.workspaceId, (tx) =>
    principalOf(tx, world.ws.workspaceId, memberId),
  );
  return undoProposal(world.deps, viewer, proposalId, randomUUID());
}

export async function load(world: CrmWorld, proposalId: string) {
  const got = await withWorkspace(world.ws.workspaceId, (tx) =>
    copilotProposalsRepo.getWithItems(tx, proposalId),
  );
  if (!got) throw new Error('proposta sumiu');
  return got;
}
