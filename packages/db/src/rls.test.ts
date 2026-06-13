import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import {
  buildVisibilityPredicate,
  pickAutoAssignee,
  resolvePeerVisibility,
} from './repos/livechat';
import {
  availabilityExceptions,
  availabilityRules,
  calendars,
  campaignDeliveries,
  campaignRecipients,
  campaignSteps,
  campaigns,
  channels,
  contacts,
  conversationEvaluations,
  conversations,
  objections,
  dataExportJobs,
  dashboardSnapshots,
  workspaceEntitlementOverrides,
  departments,
  eventParticipants,
  events,
  flowExecutions,
  flows,
  flowVersions,
  inboxVisibilitySettings,
  memberVisibilityOverrides,
  kbChunks,
  kbDocuments,
  kbFeedback,
  members,
  outboundWebhookDeliveries,
  outboundWebhooks,
  plans,
  slaRules,
  teamMembers,
  teams,
  workspaces,
} from './schema';

let wsA = '';
let wsB = '';
let memberA = '';

beforeAll(async () => {
  const db = getDb(); // conecta como owner → bypassa RLS (setup)
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const planId = free?.id ?? null;
  const suffix = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(workspaces)
    .values({ name: 'RLS A', slug: `rls-a-${suffix}`, planId })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: 'RLS B', slug: `rls-b-${suffix}`, planId })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces de teste.');
  wsA = a.id;
  wsB = b.id;

  const [mA] = await db
    .insert(members)
    .values({
      workspaceId: wsA,
      authUserId: randomUUID(),
      email: `a-${suffix}@test.local`,
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  if (!mA) throw new Error('Falha ao criar member A.');
  memberA = mA.id;
  await db.insert(members).values({
    workspaceId: wsB,
    authUserId: randomUUID(),
    email: `b-${suffix}@test.local`,
    role: 'OWNER',
    status: 'active',
  });
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('RLS multi-tenant', () => {
  it('workspace A só enxerga os próprios membros', async () => {
    const rows = await withWorkspace(wsA, (tx) => tx.select().from(members));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.workspaceId === wsA)).toBe(true);
    expect(rows.some((m) => m.workspaceId === wsB)).toBe(false);
  });

  it('workspace B não enxerga membros de A', async () => {
    const rows = await withWorkspace(wsB, (tx) => tx.select().from(members));
    expect(rows.every((m) => m.workspaceId === wsB)).toBe(true);
    expect(rows.some((m) => m.workspaceId === wsA)).toBe(false);
  });
});

describe('RLS Knowledge Base (F3-S01)', () => {
  it('kb_documents/kb_chunks/kb_feedback isolam por workspace', async () => {
    // Seed em A (como dono, bypassa RLS).
    const db = getDb();
    const [docA] = await db
      .insert(kbDocuments)
      .values({
        workspaceId: wsA,
        title: 'Doc A',
        source: 'manual',
        rawContent: '# A',
        contentSha256: 'a'.repeat(64),
      })
      .returning();
    if (!docA) throw new Error('Falha ao criar kb_document A.');
    const [chunkA] = await db
      .insert(kbChunks)
      .values({ workspaceId: wsA, documentId: docA.id, chunkIndex: 0, content: 'a', contentTokens: 1 })
      .returning();
    if (!chunkA) throw new Error('Falha ao criar kb_chunk A.');
    await db
      .insert(kbFeedback)
      .values({ workspaceId: wsA, documentId: docA.id, chunkId: chunkA.id, helpful: true });

    // Seed em B.
    const [docB] = await db
      .insert(kbDocuments)
      .values({
        workspaceId: wsB,
        title: 'Doc B',
        source: 'manual',
        rawContent: '# B',
        contentSha256: 'b'.repeat(64),
      })
      .returning();
    if (!docB) throw new Error('Falha ao criar kb_document B.');

    // A só enxerga os próprios documentos/chunks/feedback.
    const docsA = await withWorkspace(wsA, (tx) => tx.select().from(kbDocuments));
    expect(docsA.every((d) => d.workspaceId === wsA)).toBe(true);
    expect(docsA.some((d) => d.id === docB.id)).toBe(false);

    const chunksA = await withWorkspace(wsA, (tx) => tx.select().from(kbChunks));
    expect(chunksA.every((c) => c.workspaceId === wsA)).toBe(true);

    const fbA = await withWorkspace(wsA, (tx) => tx.select().from(kbFeedback));
    expect(fbA.every((f) => f.workspaceId === wsA)).toBe(true);

    // B não enxerga nada de A.
    const docsB = await withWorkspace(wsB, (tx) => tx.select().from(kbDocuments));
    expect(docsB.some((d) => d.id === docA.id)).toBe(false);
    const chunksB = await withWorkspace(wsB, (tx) => tx.select().from(kbChunks));
    expect(chunksB.some((c) => c.id === chunkA.id)).toBe(false);
  });
});

describe('RLS Flow Builder (F4-S01)', () => {
  it('flows/flow_versions/flow_executions isolam por workspace', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const [flowA] = await db
      .insert(flows)
      .values({ workspaceId: wsA, name: 'Flow A', triggerType: 'manual' })
      .returning();
    if (!flowA) throw new Error('Falha ao criar flow A.');
    const [verA] = await db
      .insert(flowVersions)
      .values({ flowId: flowA.id, version: 1, nodes: [], edges: [], triggerConfig: {} })
      .returning();
    if (!verA) throw new Error('Falha ao criar flow_version A.');
    await db.insert(flowExecutions).values({
      workspaceId: wsA,
      flowId: flowA.id,
      flowVersionId: verA.id,
      triggeredBy: 'manual',
    });

    const [flowB] = await db
      .insert(flows)
      .values({ workspaceId: wsB, name: 'Flow B', triggerType: 'manual' })
      .returning();
    if (!flowB) throw new Error('Falha ao criar flow B.');

    const flowsA = await withWorkspace(wsA, (tx) => tx.select().from(flows));
    expect(flowsA.every((f) => f.workspaceId === wsA)).toBe(true);
    expect(flowsA.some((f) => f.id === flowB.id)).toBe(false);

    // flow_versions sem workspace_id proprio: isolada via subquery em flows.
    const versA = await withWorkspace(wsA, (tx) => tx.select().from(flowVersions));
    expect(versA.some((v) => v.id === verA.id)).toBe(true);
    const versB = await withWorkspace(wsB, (tx) => tx.select().from(flowVersions));
    expect(versB.some((v) => v.id === verA.id)).toBe(false);

    const execA = await withWorkspace(wsA, (tx) => tx.select().from(flowExecutions));
    expect(execA.every((e) => e.workspaceId === wsA)).toBe(true);

    const flowsB = await withWorkspace(wsB, (tx) => tx.select().from(flows));
    expect(flowsB.some((f) => f.id === flowA.id)).toBe(false);
  });
});


describe('RLS Campaigns (F6-S01)', () => {
  it('campaigns/recipients/deliveries/steps isolam por workspace', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    const [chA] = await db
      .insert(channels)
      .values({ workspaceId: wsA, provider: 'meta_whatsapp', name: `WA A ${sfx}`, phoneNumberId: `pnid-a-${sfx}`, wabaId: `waba-a-${sfx}` })
      .returning();
    const [chB] = await db
      .insert(channels)
      .values({ workspaceId: wsB, provider: 'meta_whatsapp', name: `WA B ${sfx}`, phoneNumberId: `pnid-b-${sfx}`, wabaId: `waba-b-${sfx}` })
      .returning();
    if (!chA || !chB) throw new Error('Falha ao criar channels.');

    const [ctA] = await db
      .insert(contacts)
      .values({ workspaceId: wsA, displayName: 'Lead A', phone: `+551199999${sfx.slice(0, 4)}` })
      .returning();
    if (!ctA) throw new Error('Falha ao criar contact A.');

    const [campA] = await db
      .insert(campaigns)
      .values({ workspaceId: wsA, channelId: chA.id, name: 'Camp A', type: 'broadcast' })
      .returning();
    const [campB] = await db
      .insert(campaigns)
      .values({ workspaceId: wsB, channelId: chB.id, name: 'Camp B', type: 'broadcast' })
      .returning();
    if (!campA || !campB) throw new Error('Falha ao criar campaigns.');

    const [stepA] = await db
      .insert(campaignSteps)
      .values({ campaignId: campA.id, position: 0, templateName: 'hello_world' })
      .returning();
    if (!stepA) throw new Error('Falha ao criar campaign_step A.');

    const [recA] = await db
      .insert(campaignRecipients)
      .values({ workspaceId: wsA, campaignId: campA.id, contactId: ctA.id })
      .returning();
    if (!recA) throw new Error('Falha ao criar campaign_recipient A.');

    await db.insert(campaignDeliveries).values({
      workspaceId: wsA,
      campaignId: campA.id,
      recipientId: recA.id,
      stepId: stepA.id,
      idempotencyKey: `key-${sfx}`,
    });

    // A enxerga somente os proprios; B nao enxerga nada de A.
    const campsA = await withWorkspace(wsA, (tx) => tx.select().from(campaigns));
    expect(campsA.every((c) => c.workspaceId === wsA)).toBe(true);
    expect(campsA.some((c) => c.id === campB.id)).toBe(false);

    const campsB = await withWorkspace(wsB, (tx) => tx.select().from(campaigns));
    expect(campsB.some((c) => c.id === campA.id)).toBe(false);

    const recsB = await withWorkspace(wsB, (tx) => tx.select().from(campaignRecipients));
    expect(recsB.some((r) => r.id === recA.id)).toBe(false);

    const delsB = await withWorkspace(wsB, (tx) => tx.select().from(campaignDeliveries));
    expect(delsB.some((d) => d.campaignId === campA.id)).toBe(false);

    // campaign_steps nao tem workspace_id -> isolado via subquery em campaigns.
    const stepsA = await withWorkspace(wsA, (tx) => tx.select().from(campaignSteps));
    expect(stepsA.some((st) => st.id === stepA.id)).toBe(true);
    const stepsB = await withWorkspace(wsB, (tx) => tx.select().from(campaignSteps));
    expect(stepsB.some((st) => st.id === stepA.id)).toBe(false);
  });

  it('idempotency_key e UNIQUE — segundo insert do mesmo key falha', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ch] = await db
      .insert(channels)
      .values({ workspaceId: wsA, provider: 'meta_whatsapp', name: `WA idem ${sfx}`, phoneNumberId: `pnid-i-${sfx}`, wabaId: `waba-i-${sfx}` })
      .returning();
    const [ct] = await db
      .insert(contacts)
      .values({ workspaceId: wsA, displayName: 'Lead idem', phone: `+5511988${sfx.slice(0, 4)}` })
      .returning();
    if (!ch || !ct) throw new Error('setup');
    const [camp] = await db
      .insert(campaigns)
      .values({ workspaceId: wsA, channelId: ch.id, name: 'Camp idem', type: 'broadcast' })
      .returning();
    if (!camp) throw new Error('setup camp');
    const [step] = await db
      .insert(campaignSteps)
      .values({ campaignId: camp.id, position: 0, templateName: 'hello_world' })
      .returning();
    const [rec] = await db
      .insert(campaignRecipients)
      .values({ workspaceId: wsA, campaignId: camp.id, contactId: ct.id })
      .returning();
    if (!step || !rec) throw new Error('setup step/rec');
    const key = `idem-${sfx}`;
    await db.insert(campaignDeliveries).values({
      workspaceId: wsA,
      campaignId: camp.id,
      recipientId: rec.id,
      stepId: step.id,
      idempotencyKey: key,
    });
    await expect(
      db.insert(campaignDeliveries).values({
        workspaceId: wsA,
        campaignId: camp.id,
        recipientId: rec.id,
        stepId: step.id,
        idempotencyKey: key,
      }),
    ).rejects.toThrow();
  });
});

describe('RLS Calendar (F7-S01)', () => {
  it('calendars/availability/events isolam por workspace; event_participants via subquery', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    const [calA] = await db
      .insert(calendars)
      .values({ workspaceId: wsA, name: `Cal A ${sfx}`, type: 'personal', ownerId: memberA, isDefault: true })
      .returning();
    const [calB] = await db
      .insert(calendars)
      .values({ workspaceId: wsB, name: `Cal B ${sfx}`, type: 'workspace' })
      .returning();
    if (!calA || !calB) throw new Error('Falha ao criar calendars.');

    const [ruleA] = await db
      .insert(availabilityRules)
      .values({
        workspaceId: wsA,
        memberId: memberA,
        name: 'Comercial',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '18:00',
      })
      .returning();
    if (!ruleA) throw new Error('Falha ao criar availability_rule A.');

    const [excA] = await db
      .insert(availabilityExceptions)
      .values({
        workspaceId: wsA,
        memberId: memberA,
        startDate: '2099-01-01',
        endDate: '2099-01-01',
        isAvailable: false,
        reason: 'feriado',
      })
      .returning();
    if (!excA) throw new Error('Falha ao criar availability_exception A.');

    const [evA] = await db
      .insert(events)
      .values({
        workspaceId: wsA,
        calendarId: calA.id,
        title: 'Reuniao A',
        startAt: new Date('2099-01-04T13:00:00-03:00'),
        endAt: new Date('2099-01-04T14:00:00-03:00'),
      })
      .returning();
    if (!evA) throw new Error('Falha ao criar event A.');

    const [partA] = await db
      .insert(eventParticipants)
      .values({ eventId: evA.id, memberId: memberA, role: 'organizer' })
      .returning();
    if (!partA) throw new Error('Falha ao criar event_participant A.');

    // A enxerga os proprios; B nao enxerga nada de A.
    const calsA = await withWorkspace(wsA, (tx) => tx.select().from(calendars));
    expect(calsA.every((c) => c.workspaceId === wsA)).toBe(true);
    expect(calsA.some((c) => c.id === calB.id)).toBe(false);

    const calsB = await withWorkspace(wsB, (tx) => tx.select().from(calendars));
    expect(calsB.some((c) => c.id === calA.id)).toBe(false);

    const rulesB = await withWorkspace(wsB, (tx) => tx.select().from(availabilityRules));
    expect(rulesB.some((r) => r.id === ruleA.id)).toBe(false);

    const excB = await withWorkspace(wsB, (tx) => tx.select().from(availabilityExceptions));
    expect(excB.some((e) => e.id === excA.id)).toBe(false);

    const evsB = await withWorkspace(wsB, (tx) => tx.select().from(events));
    expect(evsB.some((e) => e.id === evA.id)).toBe(false);

    // event_participants sem workspace_id -> isolado via subquery em events.
    const partsA = await withWorkspace(wsA, (tx) => tx.select().from(eventParticipants));
    expect(partsA.some((p) => p.id === partA.id)).toBe(true);
    const partsB = await withWorkspace(wsB, (tx) => tx.select().from(eventParticipants));
    expect(partsB.some((p) => p.id === partA.id)).toBe(false);
  });

  it('compute_available_slots aplica os 3 filtros: excecao, buffer de evento e min_notice', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);

    // Member dedicado p/ isolar o calculo de outros eventos/regras do suite.
    const [m] = await db
      .insert(members)
      .values({
        workspaceId: wsA,
        authUserId: randomUUID(),
        email: `slots-${sfx}@test.local`,
        role: 'AGENT',
        status: 'active',
      })
      .returning();
    if (!m) throw new Error('Falha ao criar member de slots.');

    const [cal] = await db
      .insert(calendars)
      .values({ workspaceId: wsA, name: `Slots ${sfx}`, type: 'personal', ownerId: m.id })
      .returning();
    if (!cal) throw new Error('Falha ao criar calendar de slots.');

    // 2099-01-05 e uma segunda-feira (DOW=1). Bem no futuro -> min_notice nao
    // interfere nos filtros de excecao/buffer (todo o dia esta apos now()+min_notice).
    const targetDate = '2099-01-05';
    await db.insert(availabilityRules).values({
      workspaceId: wsA,
      memberId: m.id,
      name: 'Janela',
      dayOfWeek: 1, // segunda
      startTime: '08:00',
      endTime: '18:00',
    });

    // Filtro 1 — excecao bloqueando 10:00-11:00 local.
    await db.insert(availabilityExceptions).values({
      workspaceId: wsA,
      memberId: m.id,
      startDate: targetDate,
      endDate: targetDate,
      startTime: '10:00',
      endTime: '11:00',
      isAllDay: false,
      isAvailable: false,
      reason: 'bloqueio',
    });

    // Filtro 2 — evento 14:00-15:00 local com o member como participante.
    // Com buffer=15min, o slot 13:00-14:00 (so cai pelo buffer) tambem some.
    const [ev] = await db
      .insert(events)
      .values({
        workspaceId: wsA,
        calendarId: cal.id,
        title: 'Ocupado',
        startAt: new Date(`${targetDate}T14:00:00-03:00`),
        endAt: new Date(`${targetDate}T15:00:00-03:00`),
      })
      .returning();
    if (!ev) throw new Error('Falha ao criar evento de conflito.');
    await db.insert(eventParticipants).values({ eventId: ev.id, memberId: m.id, role: 'organizer' });

    // 60min, min_notice=30, buffer=15, ate 50 slots.
    const res = await db.execute<{ start_at: string; end_at: string; duration_minutes: number }>(sql`
      SELECT * FROM compute_available_slots(
        ${wsA}::uuid, ${m.id}::uuid, ${targetDate}::date, 60, 30, 15, 50
      )
    `);
    const rows = Array.from(res);
    // Hora local (Sao_Paulo, UTC-3) de inicio de cada slot.
    const localHours = rows.map((r) =>
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          hour12: false,
        }).format(new Date(r.start_at)),
      ),
    );

    // Sanidade: ha slots no dia.
    expect(rows.length).toBeGreaterThan(0);
    // Filtro 1: nenhum slot inicia as 10h (dentro da excecao).
    expect(localHours).not.toContain(10);
    // Filtro 2a: nenhum slot inicia as 14h (conflito direto com o evento).
    expect(localHours).not.toContain(14);
    // Filtro 2b: o slot das 13h cai SOMENTE pelo buffer (13:00-14:00 vs evento-15min=13:45) -> ausente.
    expect(localHours).not.toContain(13);
    // Filtro 2c: o slot das 15h cai pelo buffer (15:00-16:00 vs evento+15min=15:15) -> ausente.
    expect(localHours).not.toContain(15);
    // Janela valida fora dos filtros continua disponivel (ex.: 09h e 16h).
    expect(localHours).toContain(9);
    expect(localHours).toContain(16);
  });

  it('compute_available_slots respeita min_notice (slots no passado/janela imediata sao excluidos)', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);

    const [m] = await db
      .insert(members)
      .values({
        workspaceId: wsA,
        authUserId: randomUUID(),
        email: `notice-${sfx}@test.local`,
        role: 'AGENT',
        status: 'active',
      })
      .returning();
    if (!m) throw new Error('Falha ao criar member de min_notice.');

    // Janela cobrindo o dia inteiro de HOJE -> garante slots tanto antes quanto
    // depois de now(); o filtro min_notice deve cortar tudo antes de now()+notice.
    // DOW em Sao_Paulo (Sun=0..Sat=6) p/ casar com o calculo da funcao.
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
    const spWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
    }).format(new Date());
    const dow = Math.max(0, weekdays.indexOf(spWeekday as (typeof weekdays)[number]));
    await db.insert(availabilityRules).values({
      workspaceId: wsA,
      memberId: m.id,
      name: 'Dia inteiro',
      dayOfWeek: dow,
      startTime: '00:00',
      endTime: '23:00',
    });

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    ); // YYYY-MM-DD
    const minNotice = 120;
    const res = await db.execute<{ start_at: string }>(sql`
      SELECT * FROM compute_available_slots(
        ${wsA}::uuid, ${m.id}::uuid, ${today}::date, 60, ${minNotice}, 15, 50
      )
    `);
    const rows = Array.from(res);
    const threshold = Date.now() + minNotice * 60 * 1000;
    // Filtro 3: TODO slot retornado comeca em >= now()+min_notice.
    for (const r of rows) {
      expect(new Date(r.start_at).getTime()).toBeGreaterThanOrEqual(threshold - 1000);
    }
  });
});

describe('RLS Org domain (F8-S01)', () => {
  it('departments/teams/team_members/sla_rules isolam por workspace', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    const [depA] = await db
      .insert(departments)
      .values({ workspaceId: wsA, name: `Vendas ${sfx}` })
      .returning();
    const [depB] = await db
      .insert(departments)
      .values({ workspaceId: wsB, name: `Vendas ${sfx}` })
      .returning();
    if (!depA || !depB) throw new Error('Falha ao criar departments.');

    const [teamA] = await db
      .insert(teams)
      .values({ workspaceId: wsA, departmentId: depA.id, name: `Time A ${sfx}` })
      .returning();
    const [teamB] = await db
      .insert(teams)
      .values({ workspaceId: wsB, departmentId: depB.id, name: `Time B ${sfx}` })
      .returning();
    if (!teamA || !teamB) throw new Error('Falha ao criar teams.');

    await db
      .insert(teamMembers)
      .values({ teamId: teamA.id, memberId: memberA, workspaceId: wsA, role: 'lead' });

    const [slaA] = await db
      .insert(slaRules)
      .values({ workspaceId: wsA, scopeType: 'workspace', firstResponseSecs: 300 })
      .returning();
    if (!slaA) throw new Error('Falha ao criar sla_rule A.');

    // A enxerga somente os proprios; B nao enxerga nada de A.
    const depsA = await withWorkspace(wsA, (tx) => tx.select().from(departments));
    expect(depsA.every((d) => d.workspaceId === wsA)).toBe(true);
    expect(depsA.some((d) => d.id === depB.id)).toBe(false);

    const depsB = await withWorkspace(wsB, (tx) => tx.select().from(departments));
    expect(depsB.some((d) => d.id === depA.id)).toBe(false);

    const teamsB = await withWorkspace(wsB, (tx) => tx.select().from(teams));
    expect(teamsB.some((t) => t.id === teamA.id)).toBe(false);

    const tmA = await withWorkspace(wsA, (tx) => tx.select().from(teamMembers));
    expect(tmA.every((tm) => tm.workspaceId === wsA)).toBe(true);
    const tmB = await withWorkspace(wsB, (tx) => tx.select().from(teamMembers));
    expect(tmB.some((tm) => tm.teamId === teamA.id)).toBe(false);

    const slaB = await withWorkspace(wsB, (tx) => tx.select().from(slaRules));
    expect(slaB.some((s) => s.id === slaA.id)).toBe(false);
  });

  it('sla_rules: so um default (scope_type=workspace) por workspace', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [w] = await db
      .insert(workspaces)
      .values({ name: `SLA dup ${sfx}`, slug: `sla-dup-${sfx}` })
      .returning();
    if (!w) throw new Error('Falha ao criar workspace de SLA.');
    await db.insert(slaRules).values({ workspaceId: w.id, scopeType: 'workspace', firstResponseSecs: 60 });
    // Segundo default no mesmo workspace deve violar o partial unique.
    await expect(
      db.insert(slaRules).values({ workspaceId: w.id, scopeType: 'workspace', resolutionSecs: 120 }),
    ).rejects.toThrow();
    await db.delete(workspaces).where(eq(workspaces.id, w.id));
  });
});

describe('RLS Dashboard domain (F8-S01)', () => {
  it('dashboard_snapshots isola por workspace e faz upsert por (metric, scope)', async () => {
    const db = getDb();
    const [snapA] = await db
      .insert(dashboardSnapshots)
      .values({ workspaceId: wsA, metricKey: 'minhas_conversas_abertas', scope: {}, value: { count: 3 } })
      .returning();
    if (!snapA) throw new Error('Falha ao criar snapshot A.');
    await db
      .insert(dashboardSnapshots)
      .values({ workspaceId: wsB, metricKey: 'minhas_conversas_abertas', scope: {}, value: { count: 9 } });

    const snapsA = await withWorkspace(wsA, (tx) => tx.select().from(dashboardSnapshots));
    expect(snapsA.every((s) => s.workspaceId === wsA)).toBe(true);
    expect(snapsA.some((s) => s.metricKey === 'minhas_conversas_abertas')).toBe(true);

    const snapsB = await withWorkspace(wsB, (tx) => tx.select().from(dashboardSnapshots));
    expect(snapsB.some((s) => s.id === snapA.id)).toBe(false);

    // UNIQUE (workspace, metric, scope) -> segundo insert do mesmo trio falha.
    await expect(
      db
        .insert(dashboardSnapshots)
        .values({ workspaceId: wsA, metricKey: 'minhas_conversas_abertas', scope: {}, value: { count: 5 } }),
    ).rejects.toThrow();
  });

  it('materialized views mv_dashboard_* suportam REFRESH CONCURRENTLY', async () => {
    const db = getDb();
    // O UNIQUE index em cada MV habilita CONCURRENTLY; valida que o job (F8-S02) consegue.
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_volume_24h`);
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_llm_cost_month`);
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_conversions_month`);
  });
});

describe('RLS Outbound webhooks (F9-S01)', () => {
  it('outbound_webhooks e outbound_webhook_deliveries isolam por workspace', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    const [whA] = await db
      .insert(outboundWebhooks)
      .values({
        workspaceId: wsA,
        name: `Hook A ${sfx}`,
        url: 'https://example.test/a',
        secretEnc: 'enc:a',
        events: ['message.received'],
      })
      .returning();
    const [whB] = await db
      .insert(outboundWebhooks)
      .values({
        workspaceId: wsB,
        name: `Hook B ${sfx}`,
        url: 'https://example.test/b',
        secretEnc: 'enc:b',
        events: ['message.sent'],
      })
      .returning();
    if (!whA || !whB) throw new Error('Falha ao criar outbound_webhooks.');

    const [delA] = await db
      .insert(outboundWebhookDeliveries)
      .values({
        webhookId: whA.id,
        workspaceId: wsA,
        event: 'message.received',
        payload: { hello: 'world' },
        nextAttemptAt: new Date(),
      })
      .returning();
    if (!delA) throw new Error('Falha ao criar outbound_webhook_delivery A.');

    // A enxerga somente os próprios; B não enxerga nada de A.
    const hooksA = await withWorkspace(wsA, (tx) => tx.select().from(outboundWebhooks));
    expect(hooksA.every((h) => h.workspaceId === wsA)).toBe(true);
    expect(hooksA.some((h) => h.id === whB.id)).toBe(false);

    const hooksB = await withWorkspace(wsB, (tx) => tx.select().from(outboundWebhooks));
    expect(hooksB.some((h) => h.id === whA.id)).toBe(false);

    const delsA = await withWorkspace(wsA, (tx) => tx.select().from(outboundWebhookDeliveries));
    expect(delsA.every((d) => d.workspaceId === wsA)).toBe(true);
    expect(delsA.some((d) => d.id === delA.id)).toBe(true);

    const delsB = await withWorkspace(wsB, (tx) => tx.select().from(outboundWebhookDeliveries));
    expect(delsB.some((d) => d.id === delA.id)).toBe(false);

    // INSERT cross-tenant via app é barrado pelo WITH CHECK (workspace_id de B sob A).
    await expect(
      withWorkspace(wsA, (tx) =>
        tx.insert(outboundWebhooks).values({
          workspaceId: wsB,
          name: 'cross',
          url: 'https://example.test/x',
          secretEnc: 'enc:x',
          events: ['message.received'],
        }),
      ),
    ).rejects.toThrow();
  });

  it('status CHECK rejeita valor fora do domínio', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [wh] = await db
      .insert(outboundWebhooks)
      .values({
        workspaceId: wsA,
        name: `Hook chk ${sfx}`,
        url: 'https://example.test/chk',
        secretEnc: 'enc:chk',
        events: ['message.received'],
      })
      .returning();
    if (!wh) throw new Error('setup webhook');
    await expect(
      db.execute(sql`
        INSERT INTO outbound_webhook_deliveries (webhook_id, workspace_id, event, payload, status)
        VALUES (${wh.id}::uuid, ${wsA}::uuid, 'message.received', '{}'::jsonb, 'bogus')
      `),
    ).rejects.toThrow();
  });
});

describe('RLS Privacy / LGPD (F10-S02)', () => {
  it('data_export_jobs isola por workspace (B não lê job de A)', async () => {
    const db = getDb(); // owner bypassa RLS no seed

    const [jobA] = await db
      .insert(dataExportJobs)
      .values({ workspaceId: wsA, requestedBy: memberA, scope: { kind: 'workspace' } })
      .returning();
    const [jobB] = await db
      .insert(dataExportJobs)
      .values({ workspaceId: wsB, scope: { kind: 'workspace' } })
      .returning();
    if (!jobA || !jobB) throw new Error('Falha ao criar data_export_jobs.');

    // A enxerga só os próprios; B não enxerga nada de A.
    const jobsA = await withWorkspace(wsA, (tx) => tx.select().from(dataExportJobs));
    expect(jobsA.every((j) => j.workspaceId === wsA)).toBe(true);
    expect(jobsA.some((j) => j.id === jobA.id)).toBe(true);
    expect(jobsA.some((j) => j.id === jobB.id)).toBe(false);

    const jobsB = await withWorkspace(wsB, (tx) => tx.select().from(dataExportJobs));
    expect(jobsB.some((j) => j.id === jobA.id)).toBe(false);

    // INSERT cross-tenant via app é barrado pelo WITH CHECK (workspace_id de B sob A).
    await expect(
      withWorkspace(wsA, (tx) =>
        tx.insert(dataExportJobs).values({ workspaceId: wsB, scope: { kind: 'workspace' } }),
      ),
    ).rejects.toThrow();
  });

  it('status CHECK de data_export_jobs rejeita valor fora do domínio', async () => {
    const db = getDb();
    await expect(
      db.execute(sql`
        INSERT INTO data_export_jobs (workspace_id, scope, status)
        VALUES (${wsA}::uuid, '{"kind":"workspace"}'::jsonb, 'bogus')
      `),
    ).rejects.toThrow();
  });
});


describe('RLS Entitlement overrides (F26-S01)', () => {
  it('workspace_entitlement_overrides isola por workspace (B não lê override de A)', async () => {
    const db = getDb(); // owner bypassa RLS no seed

    await db
      .insert(workspaceEntitlementOverrides)
      .values({ workspaceId: wsA, limits: { max_channels: 9 }, features: { instagram: true } })
      .onConflictDoNothing();
    await db
      .insert(workspaceEntitlementOverrides)
      .values({ workspaceId: wsB, limits: { max_channels: 2 }, features: {} })
      .onConflictDoNothing();

    // A só enxerga o próprio override; B não enxerga o de A.
    const ovsA = await withWorkspace(wsA, (tx) => tx.select().from(workspaceEntitlementOverrides));
    expect(ovsA.every((o) => o.workspaceId === wsA)).toBe(true);
    expect(ovsA.some((o) => o.workspaceId === wsB)).toBe(false);

    const ovsB = await withWorkspace(wsB, (tx) => tx.select().from(workspaceEntitlementOverrides));
    expect(ovsB.some((o) => o.workspaceId === wsA)).toBe(false);

    // INSERT cross-tenant via app é barrado pelo WITH CHECK (workspace_id de B sob A).
    await expect(
      withWorkspace(wsA, (tx) =>
        tx
          .insert(workspaceEntitlementOverrides)
          .values({ workspaceId: wsB, limits: {}, features: {} }),
      ),
    ).rejects.toThrow();
  });
});

describe('RLS Agent quality / objections (F29-S01)', () => {
  it('conversation_evaluations e objections isolam por workspace; cross-tenant nega', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    const [chA] = await db
      .insert(channels)
      .values({
        workspaceId: wsA,
        provider: 'meta_whatsapp',
        name: `WA eval A ${sfx}`,
        phoneNumberId: `pnid-ea-${sfx}`,
        wabaId: `waba-ea-${sfx}`,
      })
      .returning();
    const [chB] = await db
      .insert(channels)
      .values({
        workspaceId: wsB,
        provider: 'meta_whatsapp',
        name: `WA eval B ${sfx}`,
        phoneNumberId: `pnid-eb-${sfx}`,
        wabaId: `waba-eb-${sfx}`,
      })
      .returning();
    if (!chA || !chB) throw new Error('Falha ao criar channels de eval.');

    const [convA] = await db
      .insert(conversations)
      .values({ workspaceId: wsA, channelId: chA.id, remoteId: `rem-a-${sfx}`, status: 'closed' })
      .returning();
    const [convB] = await db
      .insert(conversations)
      .values({ workspaceId: wsB, channelId: chB.id, remoteId: `rem-b-${sfx}`, status: 'closed' })
      .returning();
    if (!convA || !convB) throw new Error('Falha ao criar conversations de eval.');

    const [evA] = await db
      .insert(conversationEvaluations)
      .values({
        workspaceId: wsA,
        conversationId: convA.id,
        primaryMemberId: memberA,
        handledBy: 'human',
        qualityScore: 82,
        sentimentScore: 40,
        csatLabel: 'promoter',
        judgeModel: 'openai/gpt-4o-mini',
        judgeCostUsd: '0.000123',
      })
      .returning();
    if (!evA) throw new Error('Falha ao criar conversation_evaluation A.');

    const [evB] = await db
      .insert(conversationEvaluations)
      .values({
        workspaceId: wsB,
        conversationId: convB.id,
        handledBy: 'ai',
        qualityScore: 55,
        judgeModel: 'openai/gpt-4o-mini',
      })
      .returning();
    if (!evB) throw new Error('Falha ao criar conversation_evaluation B.');

    const [objA] = await db
      .insert(objections)
      .values({
        workspaceId: wsA,
        conversationId: convA.id,
        evaluationId: evA.id,
        category: 'price',
        label: 'Achou caro',
        excerpt: 'ta muito caro',
        resolved: false,
      })
      .returning();
    if (!objA) throw new Error('Falha ao criar objection A.');

    // A so enxerga os proprios; B nao enxerga nada de A.
    const evalsA = await withWorkspace(wsA, (tx) => tx.select().from(conversationEvaluations));
    expect(evalsA.every((e) => e.workspaceId === wsA)).toBe(true);
    expect(evalsA.some((e) => e.id === evA.id)).toBe(true);
    expect(evalsA.some((e) => e.id === evB.id)).toBe(false);

    const evalsB = await withWorkspace(wsB, (tx) => tx.select().from(conversationEvaluations));
    expect(evalsB.some((e) => e.id === evA.id)).toBe(false);

    const objsA = await withWorkspace(wsA, (tx) => tx.select().from(objections));
    expect(objsA.every((o) => o.workspaceId === wsA)).toBe(true);
    expect(objsA.some((o) => o.id === objA.id)).toBe(true);

    const objsB = await withWorkspace(wsB, (tx) => tx.select().from(objections));
    expect(objsB.some((o) => o.id === objA.id)).toBe(false);

    // INSERT cross-tenant via app e barrado pelo WITH CHECK (workspace_id de B sob A).
    await expect(
      withWorkspace(wsA, (tx) =>
        tx.insert(conversationEvaluations).values({
          workspaceId: wsB,
          conversationId: convB.id,
          handledBy: 'ai',
          qualityScore: 10,
          judgeModel: 'x',
        }),
      ),
    ).rejects.toThrow();
  });

  it('UNIQUE(conversation_id): segunda avaliacao da mesma conversa falha', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ch] = await db
      .insert(channels)
      .values({
        workspaceId: wsA,
        provider: 'meta_whatsapp',
        name: `WA uq ${sfx}`,
        phoneNumberId: `pnid-uq-${sfx}`,
        wabaId: `waba-uq-${sfx}`,
      })
      .returning();
    if (!ch) throw new Error('setup channel uq');
    const [conv] = await db
      .insert(conversations)
      .values({ workspaceId: wsA, channelId: ch.id, remoteId: `rem-uq-${sfx}`, status: 'resolved' })
      .returning();
    if (!conv) throw new Error('setup conv uq');
    await db.insert(conversationEvaluations).values({
      workspaceId: wsA,
      conversationId: conv.id,
      handledBy: 'ai',
      qualityScore: 70,
      judgeModel: 'm',
    });
    await expect(
      db.insert(conversationEvaluations).values({
        workspaceId: wsA,
        conversationId: conv.id,
        handledBy: 'ai',
        qualityScore: 71,
        judgeModel: 'm',
      }),
    ).rejects.toThrow();
  });

  it('CHECK rejeita quality_score fora de 0..100 e csat_label invalido', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const [ch] = await db
      .insert(channels)
      .values({
        workspaceId: wsA,
        provider: 'meta_whatsapp',
        name: `WA chk ${sfx}`,
        phoneNumberId: `pnid-chk-${sfx}`,
        wabaId: `waba-chk-${sfx}`,
      })
      .returning();
    if (!ch) throw new Error('setup channel chk');
    const [conv] = await db
      .insert(conversations)
      .values({ workspaceId: wsA, channelId: ch.id, remoteId: `rem-chk-${sfx}`, status: 'closed' })
      .returning();
    if (!conv) throw new Error('setup conv chk');
    await expect(
      db.execute(sql`
        INSERT INTO conversation_evaluations (workspace_id, conversation_id, handled_by, quality_score, judge_model)
        VALUES (${wsA}::uuid, ${conv.id}::uuid, 'ai', 150, 'm')
      `),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`
        INSERT INTO conversation_evaluations (workspace_id, conversation_id, handled_by, quality_score, csat_label, judge_model)
        VALUES (${wsA}::uuid, ${conv.id}::uuid, 'ai', 50, 'bogus', 'm')
      `),
    ).rejects.toThrow();
  });
});

describe('RLS Inbox visibility (F30-S01)', () => {
  it('inbox_visibility_settings e member_visibility_overrides isolam por workspace; cross-tenant nega', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const sfx = randomUUID().slice(0, 8);

    // Seed em A.
    await db
      .insert(inboxVisibilitySettings)
      .values({ workspaceId: wsA, defaultPeerVisibility: 'private', readonlySeesAll: false })
      .onConflictDoNothing();
    const [depA] = await db
      .insert(departments)
      .values({ workspaceId: wsA, name: `Suporte ${sfx}` })
      .returning();
    if (!depA) throw new Error('Falha ao criar department de visibility.');
    const [ovA] = await db
      .insert(memberVisibilityOverrides)
      .values({ workspaceId: wsA, memberId: memberA, departmentId: depA.id })
      .returning();
    if (!ovA) throw new Error('Falha ao criar member_visibility_override A.');

    // Seed em B.
    await db
      .insert(inboxVisibilitySettings)
      .values({ workspaceId: wsB, defaultPeerVisibility: 'shared', readonlySeesAll: true })
      .onConflictDoNothing();

    // A só enxerga os próprios; B não enxerga nada de A.
    const setA = await withWorkspace(wsA, (tx) => tx.select().from(inboxVisibilitySettings));
    expect(setA.every((s) => s.workspaceId === wsA)).toBe(true);
    expect(setA.some((s) => s.workspaceId === wsB)).toBe(false);

    const setB = await withWorkspace(wsB, (tx) => tx.select().from(inboxVisibilitySettings));
    expect(setB.some((s) => s.workspaceId === wsA)).toBe(false);

    const ovsA = await withWorkspace(wsA, (tx) => tx.select().from(memberVisibilityOverrides));
    expect(ovsA.every((o) => o.workspaceId === wsA)).toBe(true);
    expect(ovsA.some((o) => o.departmentId === depA.id)).toBe(true);

    const ovsB = await withWorkspace(wsB, (tx) => tx.select().from(memberVisibilityOverrides));
    expect(ovsB.some((o) => o.departmentId === depA.id)).toBe(false);

    // INSERT cross-tenant via app é barrado pelo WITH CHECK (workspace_id de B sob A).
    await expect(
      withWorkspace(wsA, (tx) =>
        tx.insert(inboxVisibilitySettings).values({ workspaceId: wsB, defaultPeerVisibility: 'shared' }),
      ),
    ).rejects.toThrow();
  });
});

describe('LiveChat repos (F30-S01)', () => {
  it('resolvePeerVisibility: team.peer_visibility tem precedência; inherit cai no default do workspace', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);

    await db
      .insert(inboxVisibilitySettings)
      .values({ workspaceId: wsA, defaultPeerVisibility: 'private' })
      .onConflictDoUpdate({
        target: inboxVisibilitySettings.workspaceId,
        set: { defaultPeerVisibility: 'private' },
      });

    const [teamShared] = await db
      .insert(teams)
      .values({ workspaceId: wsA, name: `Shared ${sfx}`, peerVisibility: 'shared' })
      .returning();
    const [teamInherit] = await db
      .insert(teams)
      .values({ workspaceId: wsA, name: `Inherit ${sfx}`, peerVisibility: 'inherit' })
      .returning();
    if (!teamShared || !teamInherit) throw new Error('Falha ao criar teams de peer-visibility.');

    expect(await resolvePeerVisibility({ workspaceId: wsA, teamId: teamShared.id })).toBe('shared');
    // inherit → default do workspace (private).
    expect(await resolvePeerVisibility({ workspaceId: wsA, teamId: teamInherit.id })).toBe('private');
    // sem time → default do workspace (private).
    expect(await resolvePeerVisibility({ workspaceId: wsA, teamId: null })).toBe('private');
  });

  it('pickAutoAssignee: manual → null; least_busy escolhe membro ativo do time', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);

    const [team] = await db
      .insert(teams)
      .values({ workspaceId: wsA, name: `AutoAssign ${sfx}`, autoAssignStrategy: 'least_busy' })
      .returning();
    if (!team) throw new Error('Falha ao criar team de auto-assign.');

    const [m] = await db
      .insert(members)
      .values({
        workspaceId: wsA,
        authUserId: randomUUID(),
        email: `assignee-${sfx}@test.local`,
        role: 'AGENT',
        status: 'active',
      })
      .returning();
    if (!m) throw new Error('Falha ao criar member de auto-assign.');
    await db.insert(teamMembers).values({ teamId: team.id, memberId: m.id, workspaceId: wsA });

    expect(await pickAutoAssignee({ teamId: team.id, strategy: 'manual' })).toBeNull();
    expect(await pickAutoAssignee({ teamId: team.id, strategy: 'least_busy' })).toBe(m.id);
    // Time vazio → sem candidato.
    const [empty] = await db
      .insert(teams)
      .values({ workspaceId: wsA, name: `Empty ${sfx}`, autoAssignStrategy: 'round_robin' })
      .returning();
    if (!empty) throw new Error('Falha ao criar team vazio.');
    expect(await pickAutoAssignee({ teamId: empty.id, strategy: 'round_robin' })).toBeNull();
  });

  it('buildVisibilityPredicate: OWNER/ADMIN sem filtro; AGENT roda como WHERE válido', async () => {
    // OWNER/ADMIN/READONLY → predicado trivial (sem filtro).
    expect(
      buildVisibilityPredicate({ memberId: memberA, role: 'OWNER', workspaceId: wsA }),
    ).toBeDefined();

    // O predicado de AGENT deve ser SQL aplicável num WHERE sem erro de sintaxe.
    const pred = buildVisibilityPredicate({ memberId: memberA, role: 'AGENT', workspaceId: wsA });
    const rows = await withWorkspace(wsA, (tx) =>
      tx.select({ id: conversations.id }).from(conversations).where(pred),
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});
