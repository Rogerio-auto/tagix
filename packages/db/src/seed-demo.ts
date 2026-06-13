/**
 * Seed DEMO — dataset rico "production-like" para ver o sistema populado.
 *
 * Cria 2 workspaces demo (imobiliária + clínica) com membros, canais (WhatsApp+Instagram),
 * contatos, conversas+mensagens, agentes+policy, pipeline+deals, conversões, campanha,
 * calendário, knowledge base e llm_usage_logs (30 dias) — além do que o `seed.ts` (bootstrap)
 * já cria. Idempotente: apaga e recria os workspaces demo por slug (cascade).
 *
 * Rodar: `pnpm --filter @hm/db seed` (bootstrap) e depois `pnpm --filter @hm/db seed:demo`.
 * Para VER: logar como platform admin (owner@dev.local) → painel /platform → Tenants/360 e
 * "Ver como" (view-as read-only) navega cada workspace populado.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { createClient } from './client';
import {
  agents,
  calendars,
  events as calendarEvents,
  campaigns,
  channels,
  contacts,
  conversations,
  conversionEvents,
  conversionTypes,
  deals,
  kbDocuments,
  llmUsageLogs,
  members,
  messages,
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
const { db, sql } = createClient(process.env['DATABASE_URL'], 1);

// ── helpers ───────────────────────────────────────────────────────────────────
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
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

interface DemoWs {
  slug: string;
  name: string;
  planKey: string;
  status: 'active' | 'trial';
  industry: 'real_estate' | 'clinic';
  igUsername: string;
}

const DEMO: readonly DemoWs[] = [
  { slug: 'imobiliaria-aurora', name: 'Imobiliária Aurora', planKey: 'pro', status: 'active', industry: 'real_estate', igUsername: 'aurora.imoveis' },
  { slug: 'clinica-vitalis', name: 'Clínica Vitalis', planKey: 'business', status: 'active', industry: 'clinic', igUsername: 'clinica.vitalis' },
];

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

console.log('[seed:demo] iniciando…');

// Apaga workspaces demo antigos (cascade) p/ idempotência.
const existing = await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.slug, DEMO.map((d) => d.slug)));
if (existing.length > 0) {
  await db.delete(workspaces).where(inArray(workspaces.id, existing.map((e) => e.id)));
  console.log(`[seed:demo] removidos ${existing.length} workspace(s) demo antigos (cascade).`);
}

// Garante planos com limites/features ricos (UI de planos/assinatura).
const PLAN_DEFS = [
  { key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0, priceYearlyCents: 0, limits: { max_agents: 1, max_channels: 1, max_monthly_messages: 1000 }, features: { instagram: false, flows: false, api_access: false } },
  { key: 'starter', name: 'Starter', position: 1, priceMonthlyCents: 9900, priceYearlyCents: 99000, limits: { max_agents: 2, max_channels: 2, max_monthly_messages: 10000 }, features: { instagram: true, flows: true, api_access: false } },
  { key: 'pro', name: 'Pro', position: 2, priceMonthlyCents: 29900, priceYearlyCents: 299000, limits: { max_agents: 5, max_channels: 5, max_monthly_messages: 50000 }, features: { instagram: true, flows: true, api_access: true } },
  { key: 'business', name: 'Business', position: 3, priceMonthlyCents: 99900, priceYearlyCents: 999000, limits: { max_agents: 20, max_channels: 20, max_monthly_messages: 500000 }, features: { instagram: true, flows: true, api_access: true } },
];
for (const p of PLAN_DEFS) {
  await db.insert(plans).values(p).onConflictDoUpdate({
    target: plans.key,
    set: { name: p.name, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, limits: p.limits, features: p.features, position: p.position },
  });
}
const allPlans = await db.select().from(plans);
const planByKey = (k: string) => allPlans.find((p) => p.key === k)!;

const MODELS = ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash', 'openai/gpt-4o'] as const;

for (const [wi, d] of DEMO.entries()) {
  const plan = planByKey(d.planKey);
  const [ws] = await db.insert(workspaces).values({
    name: d.name, slug: d.slug, planId: plan.id, subscriptionStatus: d.status,
    trialEndsAt: d.status === 'trial' ? daysAgo(-7) : null,
  }).returning();
  if (!ws) throw new Error(`falha workspace ${d.slug}`);

  await db.insert(subscriptions).values({ workspaceId: ws.id, planId: plan.id, status: d.status, billingCycle: wi === 0 ? 'monthly' : 'yearly' });

  // Membros (roles variados).
  const memberDefs = [
    { role: 'OWNER' as const, name: `${pick(FIRST, wi)} ${pick(LAST, wi)}`, platform: false },
    { role: 'ADMIN' as const, name: `${pick(FIRST, wi + 3)} ${pick(LAST, wi + 1)}`, platform: false },
    { role: 'SUPERVISOR' as const, name: `${pick(FIRST, wi + 6)} ${pick(LAST, wi + 2)}`, platform: false },
    { role: 'AGENT' as const, name: `${pick(FIRST, wi + 9)} ${pick(LAST, wi + 3)}`, platform: false },
    { role: 'AGENT' as const, name: `${pick(FIRST, wi + 12)} ${pick(LAST, wi + 4)}`, platform: false },
  ];
  const memberRows = await db.insert(members).values(
    memberDefs.map((m, i) => ({
      workspaceId: ws.id, authUserId: randomUUID(), email: `${m.role.toLowerCase()}${i}@${d.slug}.com`,
      name: m.name, role: m.role, status: 'active' as const, isPlatformAdmin: m.platform, joinedAt: daysAgo(60 - i),
    })),
  ).returning();
  const owner = memberRows[0]!;
  const agentMember = memberRows[3]!;

  // Canais: WhatsApp + Instagram (ativos).
  const [waChannel] = await db.insert(channels).values({
    workspaceId: ws.id, provider: 'meta_whatsapp', name: `${d.name} · WhatsApp`,
    phoneNumber: `+55119${(80000000 + wi).toString().slice(0, 8)}`, phoneNumberId: `pnid_${d.slug}`, wabaId: `waba_${d.slug}`,
    isActive: true, isDefault: true,
  }).returning();
  await db.insert(channels).values({
    workspaceId: ws.id, provider: 'meta_instagram', name: `${d.name} · Instagram`,
    igUserId: `ig_${d.slug}`, igUsername: d.igUsername, igAccountType: 'business', fbPageId: `fbpage_${d.slug}`,
    isActive: true,
  });

  // Agente IA + policy.
  const [agent] = await db.insert(agents).values({
    workspaceId: ws.id, name: d.industry === 'real_estate' ? 'Corretor Virtual' : 'Recepcionista Virtual',
    systemPrompt: d.industry === 'real_estate'
      ? 'Você é um corretor de imóveis cordial. Qualifique o lead, sugira imóveis e agende visitas.'
      : 'Você é a recepcionista da clínica. Tire dúvidas, informe convênios e agende consultas.',
    model: 'openai/gpt-4o-mini', status: 'active', enabledChannelIds: waChannel ? [waChannel.id] : [],
  }).returning();
  await db.insert(workspaceAgentPolicies).values({
    workspaceId: ws.id, allowedModels: [...MODELS], defaultChatModel: 'openai/gpt-4o-mini',
    maxMonthlyCostUsd: d.planKey === 'business' ? '500.00' : '150.00', updatedBy: owner.id,
  });

  // Contatos.
  const contactRows = await db.insert(contacts).values(
    Array.from({ length: 18 }, (_, i) => ({
      workspaceId: ws.id, displayName: `${pick(FIRST, i + wi)} ${pick(LAST, i)}`,
      phone: `+5511${(900000000 + i * 137 + wi * 1000).toString().slice(0, 9)}`,
      source: pick(CONTACT_SOURCES, i),
      marketingOptIn: i % 3 !== 0, ownerId: pick(memberRows, i).id, language: 'pt-BR',
    })),
  ).returning();

  // Conversas + mensagens.
  const convStatuses = ['open', 'pending', 'resolved', 'closed'] as const;
  for (let c = 0; c < 10; c++) {
    const contact = pick(contactRows, c);
    const status = pick(convStatuses, c);
    const [conv] = await db.insert(conversations).values({
      workspaceId: ws.id, channelId: waChannel!.id, contactId: contact.id, remoteId: `${contact.phone}@wa`,
      kind: 'direct', status, aiMode: c % 2 === 0 ? 'on' : 'off', assignedTo: pick(memberRows, c).id,
      lastMessagePreview: pick(REPLIES, c), lastMessageFrom: 'contact', unreadCount: status === 'open' ? (c % 3) : 0,
    }).returning();
    const nMsg = 4 + (c % 6);
    const msgVals: (typeof messages.$inferInsert)[] = [];
    for (let m = 0; m < nMsg; m++) {
      const inbound = m % 2 === 0;
      const byAgent = !inbound && conv!.aiMode === 'on';
      msgVals.push({
        workspaceId: ws.id, conversationId: conv!.id, direction: inbound ? 'inbound' : 'outbound',
        senderType: inbound ? 'contact' : byAgent ? 'agent' : 'member',
        senderMemberId: inbound || byAgent ? null : agentMember.id,
        senderAgentId: byAgent ? agent!.id : null,
        type: 'text', content: inbound ? pick(REPLIES, m + c) : pick(AGENT_REPLIES, m),
        viewStatus: 'read', createdAt: minutesAgo((nMsg - m) * 7 + c * 120),
      });
    }
    await db.insert(messages).values(msgVals);
  }

  // Pipeline (template) + deals espalhados.
  await instantiatePipelineTemplate(db, ws.id, d.industry);
  const [pipe] = await db.select().from(pipelines).where(eq(pipelines.workspaceId, ws.id)).limit(1);
  const stageRows = await db.select().from(stages).where(eq(stages.pipelineId, pipe!.id));
  stageRows.sort((a, b) => a.position - b.position);
  for (let i = 0; i < 14; i++) {
    const stage = pick(stageRows, i);
    await db.insert(deals).values({
      workspaceId: ws.id, pipelineId: pipe!.id, stageId: stage.id, contactId: pick(contactRows, i).id,
      title: d.industry === 'real_estate' ? `Apto ${2 + (i % 3)} dorms · ${pick(FIRST, i)}` : `Consulta ${pick(SPECIALTIES, i)} · ${pick(FIRST, i)}`,
      valueCents: cents(d.industry === 'real_estate' ? 350000 + i * 25000 : 350 + i * 90),
      ownerId: pick(memberRows, i).id, position: i,
      closedWon: stage.isWon ? true : stage.isLost ? false : null,
    });
  }

  // Conversões.
  const [convType] = await db.insert(conversionTypes).values({
    workspaceId: ws.id, key: d.industry === 'real_estate' ? 'venda' : 'consulta_agendada',
    label: d.industry === 'real_estate' ? 'Venda fechada' : 'Consulta agendada',
    valueRequired: true, valueLabel: 'Valor (R$)', isDefault: true,
  }).returning();
  for (let i = 0; i < 8; i++) {
    await db.insert(conversionEvents).values({
      workspaceId: ws.id, conversionTypeId: convType!.id, contactId: pick(contactRows, i + 2).id,
      valueCents: cents(d.industry === 'real_estate' ? 380000 + i * 15000 : 280 + i * 50),
      source: pick(CONV_SOURCES, i),
      triggeredByMemberId: pick(memberRows, i).id, createdAt: daysAgo(i * 3),
    });
  }

  // Campanha.
  await db.insert(campaigns).values({
    workspaceId: ws.id, channelId: waChannel!.id, name: d.industry === 'real_estate' ? 'Lançamento Residencial' : 'Check-up Anual',
    type: 'broadcast', status: 'completed', createdBy: owner.id, messagesSentToday: 0,
  });

  // Calendário + eventos.
  const [cal] = await db.insert(calendars).values({
    workspaceId: ws.id, name: `Agenda · ${d.name}`, type: 'workspace', ownerId: owner.id, isDefault: true,
  }).returning();
  for (let i = 0; i < 6; i++) {
    const start = daysAgo(-(i + 1));
    await db.insert(calendarEvents).values({
      workspaceId: ws.id, calendarId: cal!.id, contactId: pick(contactRows, i).id,
      title: d.industry === 'real_estate' ? `Visita ao imóvel · ${pick(FIRST, i)}` : `Consulta · ${pick(FIRST, i)}`,
      type: i % 2 === 0 ? 'meeting' : 'demo', status: pick(EVENT_STATUSES, i),
      startAt: start, endAt: new Date(start.getTime() + 3_600_000), createdBy: owner.id,
    });
  }

  // Knowledge base.
  const kbDocs = [
    { title: d.industry === 'real_estate' ? 'Tabela de comissões' : 'Convênios aceitos', content: 'Conteúdo de referência interno para o agente IA responder.' },
    { title: 'Perguntas frequentes', content: 'FAQ com as dúvidas mais comuns dos clientes e respostas padrão.' },
  ];
  await db.insert(kbDocuments).values(
    kbDocs.map((k) => ({
      workspaceId: ws.id, title: k.title, source: 'manual', rawContent: k.content,
      contentSha256: sha256(k.content), category: 'faq', createdBy: owner.id,
    })),
  );

  // llm_usage_logs — 30 dias, custo variado (dashboard de uso da plataforma).
  const usageVals = [];
  for (let day = 0; day < 30; day++) {
    const calls = 5 + ((day * 7 + wi * 3) % 20);
    for (let k = 0; k < calls; k++) {
      const model = pick(MODELS, day + k);
      const promptT = 200 + ((day * 31 + k * 17) % 1800);
      const compT = 80 + ((day * 13 + k * 7) % 700);
      usageVals.push({
        workspaceId: ws.id, agentId: agent!.id, requestType: 'chat', router: 'openrouter' as const,
        model, upstreamProvider: model.split('/')[0], promptTokens: promptT, completionTokens: compT,
        totalTokens: promptT + compT, costUsd: ((promptT * 0.15 + compT * 0.6) / 1_000_000).toFixed(8),
        latencyMs: 400 + ((day + k) % 1500), isTest: false, createdAt: daysAgo(day),
      });
    }
  }
  // insere em lotes p/ não estourar parâmetros
  for (let i = 0; i < usageVals.length; i += 200) {
    await db.insert(llmUsageLogs).values(usageVals.slice(i, i + 200));
  }

  console.log(`[seed:demo] ${d.name}: ${memberRows.length} membros, ${contactRows.length} contatos, 10 conversas, 14 deals, 8 conversões, ${usageVals.length} usage logs.`);
}

await sql.end();
console.log('[seed:demo] concluído ✓ — logue como owner@dev.local (platform admin) → /platform → Tenants/360 e "Ver como".');
