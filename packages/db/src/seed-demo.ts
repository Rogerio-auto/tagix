/**
 * Seed DEMO — dataset rico "production-like" para ver o sistema populado.
 *
 * Popula o workspace `dev` (do owner@dev.local — pra VER o dashboard rico logado no SEU
 * usuário) + cria 2 workspaces demo (imobiliária + clínica, pra ver via /platform e view-as).
 * Cada workspace: membros, canais (WA+IG), contatos, conversas+mensagens, agente+policy,
 * pipeline+deals, conversões, campanha, calendário, KB, llm_usage_logs (30d), agent_executions
 * (IA ops) e conversation_evaluations + objections (qualidade IA / LLM-judge F29).
 * No fim: REFRESH das materialized views do dashboard.
 *
 * Rodar: `pnpm --filter @hm/db seed` (bootstrap) e depois `pnpm --filter @hm/db seed:demo`.
 * Idempotente: recria os demo (cascade) e limpa o conteúdo do `dev` (mantém o owner).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createClient } from './client';
import {
  agentExecutions,
  agents,
  calendars,
  campaigns,
  channels,
  contacts,
  conversationEvaluations,
  conversations,
  conversionEvents,
  conversionTypes,
  deals,
  events as calendarEvents,
  kbDocuments,
  llmUsageLogs,
  members,
  messages,
  objections,
  pipelines,
  plans,
  stages,
  subscriptions,
  workspaceAgentPolicies,
  workspaces,
} from './schema';
import { instantiatePipelineTemplate } from './seed/pipeline_templates';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../../../.env') });
const { db, sql: sqlClient } = createClient(process.env['DATABASE_URL'], 1);

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);
const cents = (reais: number): number => Math.round(reais * 100);

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Karina', 'Lucas', 'Marina', 'Newton', 'Olívia', 'Paulo', 'Renata', 'Sérgio', 'Tatiana', 'Vitor'] as const;
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Almeida', 'Ferreira', 'Rodrigues', 'Gomes'] as const;
const CONTACT_SOURCES = ['whatsapp', 'instagram', 'site', 'indicação'] as const;
const CONV_SOURCES = ['manual', 'deal_won', 'agent_tool'] as const;
const SPECIALTIES = ['Cardio', 'Derma', 'Orto', 'Clínico'] as const;
const EVENT_STATUSES = ['scheduled', 'confirmed'] as const;
const CSAT = ['promoter', 'neutral', 'detractor'] as const;
const OBJECTION_CATS = ['price', 'timing', 'trust', 'competitor', 'feature_gap', 'authority', 'other'] as const;
const OBJECTION_LABELS: Record<string, string> = {
  price: 'Achou caro', timing: 'Quer pensar / sem pressa', trust: 'Receio / desconfiança',
  competitor: 'Comparando com concorrente', feature_gap: 'Falta de funcionalidade',
  authority: 'Precisa consultar terceiro', other: 'Outro',
};
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const MODELS = ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash', 'openai/gpt-4o'] as const;
const REPLIES = [
  'Olá! Tenho interesse, pode me passar mais detalhes?',
  'Perfeito, qual o valor e a disponibilidade?',
  'Consigo agendar para essa semana?',
  'Obrigado pela atenção! Vou avaliar e retorno.',
  'Pode me enviar por aqui mesmo?',
] as const;
const AGENT_REPLIES = [
  'Claro! Posso te ajudar com isso agora mesmo.',
  'Temos ótimas opções dentro do que você procura. Quer que eu agende?',
  'Já reservei um horário pra você. Confirmo por aqui?',
  'Perfeito! Vou registrar e nossa equipe dá sequência.',
] as const;

type Industry = 'real_estate' | 'clinic';
interface WsDesc { slug: string; name: string; industry: Industry; igUsername: string }

async function seedContent(ws: { id: string }, d: WsDesc, existingOwnerId?: string): Promise<number> {
  const newDefs = existingOwnerId
    ? [{ role: 'ADMIN' as const, i: 1 }, { role: 'SUPERVISOR' as const, i: 2 }, { role: 'AGENT' as const, i: 3 }, { role: 'AGENT' as const, i: 4 }]
    : [{ role: 'OWNER' as const, i: 0 }, { role: 'ADMIN' as const, i: 1 }, { role: 'SUPERVISOR' as const, i: 2 }, { role: 'AGENT' as const, i: 3 }, { role: 'AGENT' as const, i: 4 }];
  const created = await db.insert(members).values(
    newDefs.map((m) => ({
      workspaceId: ws.id, authUserId: randomUUID(), email: `${m.role.toLowerCase()}${m.i}@${d.slug}.com`,
      name: `${pick(FIRST, m.i * 3)} ${pick(LAST, m.i)}`, role: m.role, status: 'active' as const, joinedAt: daysAgo(60 - m.i),
    })),
  ).returning();
  const ownerId = existingOwnerId ?? created[0]!.id;
  const memberRows = existingOwnerId ? [{ id: ownerId }, ...created] : created;
  const agentMemberId = pick(memberRows, 3).id;

  const [waChannel] = await db.insert(channels).values({
    workspaceId: ws.id, provider: 'meta_whatsapp', name: `${d.name} · WhatsApp`,
    phoneNumber: `+5511${(980000000 + d.slug.length).toString().slice(0, 9)}`, phoneNumberId: `pnid_${d.slug}`, wabaId: `waba_${d.slug}`,
    isActive: true, isDefault: true,
  }).returning();
  await db.insert(channels).values({
    workspaceId: ws.id, provider: 'meta_instagram', name: `${d.name} · Instagram`,
    igUserId: `ig_${d.slug}`, igUsername: d.igUsername, igAccountType: 'business', fbPageId: `fbpage_${d.slug}`, isActive: true,
  });

  const [agent] = await db.insert(agents).values({
    workspaceId: ws.id, name: d.industry === 'real_estate' ? 'Corretor Virtual' : 'Recepcionista Virtual',
    systemPrompt: d.industry === 'real_estate'
      ? 'Você é um corretor de imóveis cordial. Qualifique o lead, sugira imóveis e agende visitas.'
      : 'Você é a recepcionista da clínica. Tire dúvidas, informe convênios e agende consultas.',
    model: 'openai/gpt-4o-mini', status: 'active', enabledChannelIds: waChannel ? [waChannel.id] : [],
  }).returning();
  await db.insert(workspaceAgentPolicies).values({
    workspaceId: ws.id, allowedModels: [...MODELS], defaultChatModel: 'openai/gpt-4o-mini', maxMonthlyCostUsd: '300.00', updatedBy: ownerId,
  });

  const contactRows = await db.insert(contacts).values(
    Array.from({ length: 18 }, (_, i) => ({
      workspaceId: ws.id, displayName: `${pick(FIRST, i)} ${pick(LAST, i + 1)}`,
      phone: `+5511${(900000000 + i * 137 + d.slug.length * 1000).toString().slice(0, 9)}`,
      source: pick(CONTACT_SOURCES, i), marketingOptIn: i % 3 !== 0, ownerId: pick(memberRows, i).id, language: 'pt-BR',
    })),
  ).returning();

  const convStatuses = ['open', 'pending', 'resolved', 'closed'] as const;
  const convMeta: { id: string; status: string; aiMode: string; memberId: string }[] = [];
  for (let c = 0; c < 12; c++) {
    const contact = pick(contactRows, c);
    const status = pick(convStatuses, c);
    const aiMode = c % 2 === 0 ? 'on' : 'off';
    const memberId = pick(memberRows, c).id;
    const [conv] = await db.insert(conversations).values({
      workspaceId: ws.id, channelId: waChannel!.id, contactId: contact.id, remoteId: `${contact.phone}@wa`,
      kind: 'direct', status, aiMode, assignedTo: memberId,
      lastMessagePreview: pick(REPLIES, c), lastMessageFrom: 'contact', unreadCount: status === 'open' ? c % 3 : 0,
      createdAt: daysAgo(c % 14), updatedAt: minutesAgo(c * 30),
    }).returning();
    convMeta.push({ id: conv!.id, status, aiMode, memberId });
    const nMsg = 4 + (c % 6);
    const msgVals: (typeof messages.$inferInsert)[] = [];
    for (let m = 0; m < nMsg; m++) {
      const inbound = m % 2 === 0;
      const byAgent = !inbound && aiMode === 'on';
      msgVals.push({
        workspaceId: ws.id, conversationId: conv!.id, direction: inbound ? 'inbound' : 'outbound',
        senderType: inbound ? 'contact' : byAgent ? 'agent' : 'member',
        senderMemberId: inbound || byAgent ? null : agentMemberId, senderAgentId: byAgent ? agent!.id : null,
        type: 'text', content: inbound ? pick(REPLIES, m + c) : pick(AGENT_REPLIES, m),
        viewStatus: 'read', createdAt: minutesAgo((nMsg - m) * 6 + c * 90),
      });
    }
    await db.insert(messages).values(msgVals);
  }

  for (const cm of convMeta.filter((c) => c.aiMode === 'on')) {
    const startedAt = minutesAgo(60 + Math.floor(Math.random() * 6000));
    await db.insert(agentExecutions).values({
      workspaceId: ws.id, agentId: agent!.id, conversationId: cm.id, threadId: cm.id, status: 'completed', state: {},
      totalTokens: 600 + Math.floor(Math.random() * 3000), totalCostUsd: (0.002 + Math.random() * 0.02).toFixed(6),
      startedAt, completedAt: new Date(startedAt.getTime() + (800 + Math.floor(Math.random() * 5000))),
    });
  }

  for (const [idx, cm] of convMeta.filter((c) => c.status === 'resolved' || c.status === 'closed').entries()) {
    const handledBy = cm.aiMode === 'on' ? (idx % 3 === 0 ? 'mixed' : 'ai') : 'human';
    const quality = 62 + ((idx * 17) % 36);
    const [evalRow] = await db.insert(conversationEvaluations).values({
      workspaceId: ws.id, conversationId: cm.id, agentId: handledBy === 'human' ? null : agent!.id, primaryMemberId: cm.memberId,
      handledBy, qualityScore: quality,
      qualityRationale: quality >= 85 ? 'Atendimento ágil, resolveu a dúvida e conduziu ao próximo passo.' : 'Atendeu, mas demorou a endereçar a objeção principal.',
      csatLabel: pick(CSAT, quality >= 85 ? 0 : quality >= 72 ? 1 : 2), sentimentScore: quality - 50,
      judgeModel: 'openai/gpt-4o-mini', judgeCostUsd: '0.000420', raw: {},
    }).returning();
    if (idx % 2 === 0 && evalRow) {
      const cat = pick(OBJECTION_CATS, idx);
      await db.insert(objections).values({
        workspaceId: ws.id, conversationId: cm.id, evaluationId: evalRow.id, category: cat,
        label: OBJECTION_LABELS[cat] ?? cat, excerpt: pick(REPLIES, idx), resolved: idx % 3 === 0,
      });
    }
  }

  await instantiatePipelineTemplate(db, ws.id, d.industry);
  const [pipe] = await db.select().from(pipelines).where(eq(pipelines.workspaceId, ws.id)).limit(1);
  const stageRows = (await db.select().from(stages).where(eq(stages.pipelineId, pipe!.id))).sort((a, b) => a.position - b.position);
  for (let i = 0; i < 14; i++) {
    const stage = pick(stageRows, i);
    await db.insert(deals).values({
      workspaceId: ws.id, pipelineId: pipe!.id, stageId: stage.id, contactId: pick(contactRows, i).id,
      title: d.industry === 'real_estate' ? `Apto ${2 + (i % 3)} dorms · ${pick(FIRST, i)}` : `Consulta ${pick(SPECIALTIES, i)} · ${pick(FIRST, i)}`,
      valueCents: cents(d.industry === 'real_estate' ? 350000 + i * 25000 : 350 + i * 90),
      ownerId: pick(memberRows, i).id, position: i, closedWon: stage.isWon ? true : stage.isLost ? false : null,
    });
  }

  const [convType] = await db.insert(conversionTypes).values({
    workspaceId: ws.id, key: d.industry === 'real_estate' ? 'venda' : 'consulta_agendada',
    label: d.industry === 'real_estate' ? 'Venda fechada' : 'Consulta agendada', valueRequired: true, valueLabel: 'Valor (R$)', isDefault: true,
  }).returning();
  for (let i = 0; i < 8; i++) {
    await db.insert(conversionEvents).values({
      workspaceId: ws.id, conversionTypeId: convType!.id, contactId: pick(contactRows, i + 2).id,
      valueCents: cents(d.industry === 'real_estate' ? 380000 + i * 15000 : 280 + i * 50),
      source: pick(CONV_SOURCES, i), triggeredByMemberId: pick(memberRows, i).id, createdAt: daysAgo(i * 2),
    });
  }

  await db.insert(campaigns).values({
    workspaceId: ws.id, channelId: waChannel!.id, name: d.industry === 'real_estate' ? 'Lançamento Residencial' : 'Check-up Anual',
    type: 'broadcast', status: 'completed', createdBy: ownerId, messagesSentToday: 0,
  });

  const [cal] = await db.insert(calendars).values({ workspaceId: ws.id, name: `Agenda · ${d.name}`, type: 'workspace', ownerId, isDefault: true }).returning();
  for (let i = 0; i < 6; i++) {
    const start = daysAgo(-(i + 1));
    await db.insert(calendarEvents).values({
      workspaceId: ws.id, calendarId: cal!.id, contactId: pick(contactRows, i).id,
      title: d.industry === 'real_estate' ? `Visita ao imóvel · ${pick(FIRST, i)}` : `Consulta · ${pick(FIRST, i)}`,
      type: i % 2 === 0 ? 'meeting' : 'demo', status: pick(EVENT_STATUSES, i),
      startAt: start, endAt: new Date(start.getTime() + 3_600_000), createdBy: ownerId,
    });
  }

  const kbDocs = [
    { title: d.industry === 'real_estate' ? 'Tabela de comissões' : 'Convênios aceitos', content: 'Conteúdo de referência interno para o agente IA responder.' },
    { title: 'Perguntas frequentes', content: 'FAQ com as dúvidas mais comuns dos clientes e respostas padrão.' },
  ];
  await db.insert(kbDocuments).values(
    kbDocs.map((k) => ({ workspaceId: ws.id, title: k.title, source: 'manual', rawContent: k.content, contentSha256: sha256(k.content + d.slug), category: 'faq', createdBy: ownerId })),
  );

  const usageVals: (typeof llmUsageLogs.$inferInsert)[] = [];
  for (let day = 0; day < 30; day++) {
    const calls = 5 + ((day * 7 + d.slug.length) % 20);
    for (let k = 0; k < calls; k++) {
      const model = pick(MODELS, day + k);
      const promptT = 200 + ((day * 31 + k * 17) % 1800);
      const compT = 80 + ((day * 13 + k * 7) % 700);
      usageVals.push({
        workspaceId: ws.id, agentId: agent!.id, requestType: 'chat', router: 'openrouter',
        model, upstreamProvider: model.split('/')[0], promptTokens: promptT, completionTokens: compT,
        totalTokens: promptT + compT, costUsd: ((promptT * 0.15 + compT * 0.6) / 1_000_000).toFixed(8),
        latencyMs: 400 + ((day + k) % 1500), isTest: false, createdAt: daysAgo(day),
      });
    }
  }
  for (let i = 0; i < usageVals.length; i += 200) await db.insert(llmUsageLogs).values(usageVals.slice(i, i + 200));

  console.log(`[seed:demo] ${d.name}: ${memberRows.length} membros, 18 contatos, 12 conversas, 14 deals, 8 conversões, ${usageVals.length} usage logs, IA ops + avaliações.`);
  return usageVals.length;
}

async function clearWorkspaceContent(wsId: string, keepOwnerId: string): Promise<void> {
  await db.delete(objections).where(eq(objections.workspaceId, wsId));
  await db.delete(conversationEvaluations).where(eq(conversationEvaluations.workspaceId, wsId));
  await db.delete(agentExecutions).where(eq(agentExecutions.workspaceId, wsId));
  await db.delete(llmUsageLogs).where(eq(llmUsageLogs.workspaceId, wsId));
  await db.delete(calendarEvents).where(eq(calendarEvents.workspaceId, wsId));
  await db.delete(calendars).where(eq(calendars.workspaceId, wsId));
  await db.delete(conversionEvents).where(eq(conversionEvents.workspaceId, wsId));
  await db.delete(conversionTypes).where(eq(conversionTypes.workspaceId, wsId));
  await db.delete(campaigns).where(eq(campaigns.workspaceId, wsId));
  await db.delete(kbDocuments).where(eq(kbDocuments.workspaceId, wsId));
  await db.delete(messages).where(eq(messages.workspaceId, wsId));
  await db.delete(deals).where(eq(deals.workspaceId, wsId));
  await db.delete(conversations).where(eq(conversations.workspaceId, wsId));
  await db.delete(stages).where(eq(stages.workspaceId, wsId));
  await db.delete(pipelines).where(eq(pipelines.workspaceId, wsId));
  await db.delete(workspaceAgentPolicies).where(eq(workspaceAgentPolicies.workspaceId, wsId));
  await db.delete(agents).where(eq(agents.workspaceId, wsId));
  await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
  await db.delete(channels).where(eq(channels.workspaceId, wsId));
  await db.delete(members).where(sql`${members.workspaceId} = ${wsId} and ${members.id} <> ${keepOwnerId}`);
}

console.log('[seed:demo] iniciando…');

const PLAN_DEFS = [
  { key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0, priceYearlyCents: 0, limits: { max_agents: 1, max_channels: 1, max_monthly_messages: 1000 }, features: { instagram: false, flows: false, api_access: false } },
  { key: 'starter', name: 'Starter', position: 1, priceMonthlyCents: 9900, priceYearlyCents: 99000, limits: { max_agents: 2, max_channels: 2, max_monthly_messages: 10000 }, features: { instagram: true, flows: true, api_access: false } },
  { key: 'pro', name: 'Pro', position: 2, priceMonthlyCents: 29900, priceYearlyCents: 299000, limits: { max_agents: 5, max_channels: 5, max_monthly_messages: 50000 }, features: { instagram: true, flows: true, api_access: true } },
  { key: 'business', name: 'Business', position: 3, priceMonthlyCents: 99900, priceYearlyCents: 999000, limits: { max_agents: 20, max_channels: 20, max_monthly_messages: 500000 }, features: { instagram: true, flows: true, api_access: true } },
];
for (const p of PLAN_DEFS) {
  await db.insert(plans).values(p).onConflictDoUpdate({ target: plans.key, set: { name: p.name, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, limits: p.limits, features: p.features, position: p.position } });
}
const allPlans = await db.select().from(plans);
const planByKey = (k: string) => allPlans.find((p) => p.key === k)!;

// 1) Workspace `dev` (SEU usuário owner@dev.local) — popula in-place, mantém o owner.
const [devWs] = await db.select().from(workspaces).where(eq(workspaces.slug, 'dev')).limit(1);
if (!devWs) throw new Error('Workspace dev não existe — rode `pnpm --filter @hm/db seed` antes.');
const [devOwner] = await db.select().from(members).where(and(eq(members.workspaceId, devWs.id), eq(members.role, 'OWNER'))).limit(1);
if (!devOwner) throw new Error('Owner OWNER do dev não encontrado — rode `pnpm --filter @hm/db seed`.');
await clearWorkspaceContent(devWs.id, devOwner.id);
const proPlan = planByKey('pro');
await db.update(workspaces).set({ planId: proPlan.id, subscriptionStatus: 'active', trialEndsAt: null }).where(eq(workspaces.id, devWs.id));
await db.delete(subscriptions).where(eq(subscriptions.workspaceId, devWs.id));
await db.insert(subscriptions).values({ workspaceId: devWs.id, planId: proPlan.id, status: 'active', billingCycle: 'monthly' });
await seedContent(devWs, { slug: 'dev', name: 'Dev Workspace', industry: 'real_estate', igUsername: 'dev.studio' }, devOwner.id);
console.log('[seed:demo] workspace dev populado (owner@dev.local mantido, plano Pro).');

// 2) Workspaces demo (pra ver via /platform + view-as).
const DEMO: readonly (WsDesc & { planKey: string })[] = [
  { slug: 'imobiliaria-aurora', name: 'Imobiliária Aurora', planKey: 'pro', industry: 'real_estate', igUsername: 'aurora.imoveis' },
  { slug: 'clinica-vitalis', name: 'Clínica Vitalis', planKey: 'business', industry: 'clinic', igUsername: 'clinica.vitalis' },
];
const oldDemo = await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.slug, DEMO.map((x) => x.slug)));
if (oldDemo.length > 0) await db.delete(workspaces).where(inArray(workspaces.id, oldDemo.map((e) => e.id)));
for (const [wi, d] of DEMO.entries()) {
  const plan = planByKey(d.planKey);
  const [ws] = await db.insert(workspaces).values({ name: d.name, slug: d.slug, planId: plan.id, subscriptionStatus: 'active' }).returning();
  await db.insert(subscriptions).values({ workspaceId: ws!.id, planId: plan.id, status: 'active', billingCycle: wi === 0 ? 'monthly' : 'yearly' });
  await seedContent(ws!, d);
}

// 3) REFRESH das materialized views do dashboard.
for (const mv of ['mv_dashboard_volume_24h', 'mv_dashboard_llm_cost_month', 'mv_dashboard_conversions_month']) {
  try { await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`)); }
  catch { await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${mv}`)); }
}
console.log('[seed:demo] materialized views do dashboard atualizadas.');

await sqlClient.end();
console.log('[seed:demo] concluído ✓ — logue como owner@dev.local: dashboard de / mostra o dev rico; /platform mostra os 3 tenants.');
