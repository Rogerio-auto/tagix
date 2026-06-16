/**
 * F30-S07 — Testes de enforcement de visibilidade na lista de conversas.
 *
 * Testa os dois eixos de visibilidade (LIVECHAT_OPS §1 / PERMISSIONS §2.1):
 *   - Eixo 1 (escopo): ADMIN vê tudo; SUPERVISOR vê depts que lidera; AGENT só
 *     os seus depts + overrides; READONLY vê tudo.
 *   - Eixo 2 (peer-privacy): em workspace com default_peer_visibility='private',
 *     AGENT só vê conversas atribuídas a si ou em times que lidera.
 *   - Override por membro: concede dept extra ao AGENT além dos seus.
 *   - Filtros: department / team / assigned=me|others|<uuid>.
 *
 * Autenticação: mock cookie (base64url) via MockAuthProvider.
 * Banco: dev postgres real (DATABASE_URL do .env); cleanup no afterAll.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { SESSION_COOKIE } from '../../auth/session';
import { createApp } from '../../app';
import { bumpVersion, closeCache } from '../../cache';
import { closeHealth } from '../../health';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cria um mock cookie compatível com MockAuthProvider (base64url JSON). */
function cookieFor(authUserId: string, email: string): string {
  const token = Buffer.from(JSON.stringify({ authUserId, email, iat: Date.now() })).toString('base64url');
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

// ─── Fixtures do suite de isolamento ─────────────────────────────────────────

const sfx = randomUUID().slice(0, 8);
const db = getDb();

// IDs resolvidos no beforeAll
let wsId = '';

// Departamentos
let deptAId = '';
let deptBId = '';

// Times
let teamA1Id = ''; // no dept A (peer_visibility = inherit → shared por default)
let teamA2Id = ''; // no dept A (peer_visibility = private)
let teamBId = ''; // no dept B

// Membros
let adminAuthId = '';
let adminEmail = '';
let adminCookie = '';

let supAuthId = '';
let supEmail = '';
let supCookie = '';
let supMemberId = '';

let agentAAuthId = '';
let agentAEmail = '';
let agentACookie = '';
let agentAMemberId = '';

let agentBAuthId = '';
let agentBEmail = '';
let agentBCookie = '';
let agentBMemberId = '';

let agentC_Auth = ''; // Agent sem dept (não pertence a nenhum time)
let agentCEmail = '';
let agentCCookie = '';

// Conversas
let convDeptA_Shared = ''; // dept A, team A1 (shared), atribuída ao agentA
let convDeptA_Private_AgentA = ''; // dept A, team A2 (private), atribuída ao agentA
let convDeptA_Private_AgentB = ''; // dept A, team A2 (private), atribuída ao agentB (não deve aparecer para agentA)
let convDeptB = ''; // dept B, sem time, atribuída ao agentB
let convNoDept = ''; // sem dept, sem time, sem atribuição

// Canal
let channelId = '';

const app = createApp();

beforeAll(async () => {
  // ── Workspace ──────────────────────────────────────────────────────────────
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: `Visibility WS ${sfx}`, slug: `vis-ws-${sfx}` })
    .returning();
  if (!ws) throw new Error('Falha ao criar workspace.');
  wsId = ws.id;

  // ── Canal (necessário para conversations.channel_id FK) ────────────────────
  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId: wsId,
      provider: 'meta_whatsapp',
      name: `Canal ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  if (!ch) throw new Error('Falha ao criar canal.');
  channelId = ch.id;

  // ── Departamentos ──────────────────────────────────────────────────────────
  const [dA] = await db
    .insert(schema.departments)
    .values({ workspaceId: wsId, name: `Dept A ${sfx}` })
    .returning();
  const [dB] = await db
    .insert(schema.departments)
    .values({ workspaceId: wsId, name: `Dept B ${sfx}` })
    .returning();
  if (!dA || !dB) throw new Error('Falha ao criar departamentos.');
  deptAId = dA.id;
  deptBId = dB.id;

  // ── Times ──────────────────────────────────────────────────────────────────
  // team A1: peer_visibility = 'inherit' → herdará workspace default (shared)
  const [tA1] = await db
    .insert(schema.teams)
    .values({ workspaceId: wsId, departmentId: deptAId, name: `TeamA1 ${sfx}`, peerVisibility: 'inherit' })
    .returning();
  // team A2: peer_visibility = 'private' → cada agente só vê suas conversas
  const [tA2] = await db
    .insert(schema.teams)
    .values({ workspaceId: wsId, departmentId: deptAId, name: `TeamA2 ${sfx}`, peerVisibility: 'private' })
    .returning();
  // team B: no dept B
  const [tB] = await db
    .insert(schema.teams)
    .values({ workspaceId: wsId, departmentId: deptBId, name: `TeamB ${sfx}`, peerVisibility: 'shared' })
    .returning();
  if (!tA1 || !tA2 || !tB) throw new Error('Falha ao criar times.');
  teamA1Id = tA1.id;
  teamA2Id = tA2.id;
  teamBId = tB.id;

  // ── Membros ────────────────────────────────────────────────────────────────
  adminAuthId = randomUUID();
  adminEmail = `vis-admin-${sfx}@t.local`;
  const [admin] = await db
    .insert(schema.members)
    .values({ workspaceId: wsId, authUserId: adminAuthId, email: adminEmail, role: 'ADMIN', status: 'active' })
    .returning();
  if (!admin) throw new Error('Falha ao criar admin.');
  adminCookie = cookieFor(adminAuthId, adminEmail);

  supAuthId = randomUUID();
  supEmail = `vis-sup-${sfx}@t.local`;
  const [sup] = await db
    .insert(schema.members)
    .values({ workspaceId: wsId, authUserId: supAuthId, email: supEmail, role: 'SUPERVISOR', status: 'active' })
    .returning();
  if (!sup) throw new Error('Falha ao criar supervisor.');
  supMemberId = sup.id;
  supCookie = cookieFor(supAuthId, supEmail);

  agentAAuthId = randomUUID();
  agentAEmail = `vis-agentA-${sfx}@t.local`;
  const [agA] = await db
    .insert(schema.members)
    .values({ workspaceId: wsId, authUserId: agentAAuthId, email: agentAEmail, role: 'AGENT', status: 'active' })
    .returning();
  if (!agA) throw new Error('Falha ao criar agentA.');
  agentAMemberId = agA.id;
  agentACookie = cookieFor(agentAAuthId, agentAEmail);

  agentBAuthId = randomUUID();
  agentBEmail = `vis-agentB-${sfx}@t.local`;
  const [agB] = await db
    .insert(schema.members)
    .values({ workspaceId: wsId, authUserId: agentBAuthId, email: agentBEmail, role: 'AGENT', status: 'active' })
    .returning();
  if (!agB) throw new Error('Falha ao criar agentB.');
  agentBMemberId = agB.id;
  agentBCookie = cookieFor(agentBAuthId, agentBEmail);

  agentC_Auth = randomUUID();
  agentCEmail = `vis-agentC-${sfx}@t.local`;
  const [agC] = await db
    .insert(schema.members)
    .values({ workspaceId: wsId, authUserId: agentC_Auth, email: agentCEmail, role: 'AGENT', status: 'active' })
    .returning();
  if (!agC) throw new Error('Falha ao criar agentC.');
  agentCCookie = cookieFor(agentC_Auth, agentCEmail);

  // ── Memberships de times ───────────────────────────────────────────────────
  // Supervisor lidera team A1 (dept A) via role='lead'
  await db.insert(schema.teamMembers).values({
    workspaceId: wsId,
    teamId: teamA1Id,
    memberId: supMemberId,
    role: 'lead',
  });

  // Agent A pertence a team A1 (dept A, shared) e team A2 (dept A, private)
  await db.insert(schema.teamMembers).values([
    { workspaceId: wsId, teamId: teamA1Id, memberId: agentAMemberId, role: 'member' },
    { workspaceId: wsId, teamId: teamA2Id, memberId: agentAMemberId, role: 'member' },
  ]);

  // Agent B pertence a team A2 (dept A, private) e team B (dept B)
  await db.insert(schema.teamMembers).values([
    { workspaceId: wsId, teamId: teamA2Id, memberId: agentBMemberId, role: 'member' },
    { workspaceId: wsId, teamId: teamBId, memberId: agentBMemberId, role: 'member' },
  ]);
  // Agent C: sem memberships → não pertence a nenhum dept

  // ── Conversas de teste ─────────────────────────────────────────────────────
  // conv 1: dept A, team A1 (shared), atribuída ao agent A
  const [c1] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId,
      remoteId: `rem-c1-${sfx}`,
      departmentId: deptAId,
      teamId: teamA1Id,
      assignedTo: agentAMemberId,
    })
    .returning();
  if (!c1) throw new Error('Falha ao criar conv 1.');
  convDeptA_Shared = c1.id;

  // conv 2: dept A, team A2 (private), atribuída ao agent A
  const [c2] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId,
      remoteId: `rem-c2-${sfx}`,
      departmentId: deptAId,
      teamId: teamA2Id,
      assignedTo: agentAMemberId,
    })
    .returning();
  if (!c2) throw new Error('Falha ao criar conv 2.');
  convDeptA_Private_AgentA = c2.id;

  // conv 3: dept A, team A2 (private), atribuída ao agent B
  const [c3] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId,
      remoteId: `rem-c3-${sfx}`,
      departmentId: deptAId,
      teamId: teamA2Id,
      assignedTo: agentBMemberId,
    })
    .returning();
  if (!c3) throw new Error('Falha ao criar conv 3.');
  convDeptA_Private_AgentB = c3.id;

  // conv 4: dept B, team B (shared), atribuída ao agent B
  const [c4] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId,
      remoteId: `rem-c4-${sfx}`,
      departmentId: deptBId,
      teamId: teamBId,
      assignedTo: agentBMemberId,
    })
    .returning();
  if (!c4) throw new Error('Falha ao criar conv 4.');
  convDeptB = c4.id;

  // conv 5: sem dept, sem time, sem atribuição
  const [c5] = await db
    .insert(schema.conversations)
    .values({
      workspaceId: wsId,
      channelId,
      remoteId: `rem-c5-${sfx}`,
    })
    .returning();
  if (!c5) throw new Error('Falha ao criar conv 5.');
  convNoDept = c5.id;
});

afterAll(async () => {
  if (wsId) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsId));
  await closeCache();
  await closeHealth();
  await closeDb();
});

// ─── Suíte de segurança base ──────────────────────────────────────────────────

describe('GET /api/conversations — sem sessão', () => {
  it('401 sem cookie', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('401 em mensagens sem cookie', async () => {
    const res = await request(app).get('/api/conversations/abc/messages');
    expect(res.status).toBe(401);
  });
});

// ─── Eixo 1 — isolamento por role ────────────────────────────────────────────

describe('Isolamento por role (eixo 1)', () => {
  /** Extrai IDs de conversas da resposta */
  function ids(body: { conversations: Array<{ id: string }> }): string[] {
    return body.conversations.map((c) => c.id);
  }

  it('ADMIN vê todas as conversas do workspace', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const convIds = ids(res.body as { conversations: Array<{ id: string }> });
    // Admin vê tudo: as 5 conversas do workspace
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).toContain(convDeptA_Private_AgentB);
    expect(convIds).toContain(convDeptB);
    expect(convIds).toContain(convNoDept);
  });

  it('SUPERVISOR vê apenas depts que lidera (dept A, via team A1 lead)', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Cookie', supCookie);
    expect(res.status).toBe(200);
    const convIds = ids(res.body as { conversations: Array<{ id: string }> });
    // Supervisor lidera team A1 (dept A) → vê conversas de dept A
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).toContain(convDeptA_Private_AgentB);
    // Não lidera dept B → não vê convDeptB
    expect(convIds).not.toContain(convDeptB);
    // Conv sem dept → não vê (não está no escopo)
    expect(convIds).not.toContain(convNoDept);
  });

  it('AGENT A vê dept A (team A1 shared + team A2 private), mas só as suas no team A2', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Cookie', agentACookie);
    expect(res.status).toBe(200);
    const convIds = ids(res.body as { conversations: Array<{ id: string }> });

    // Team A1 é shared → vê todas do team A1 (convDeptA_Shared)
    expect(convIds).toContain(convDeptA_Shared);

    // Team A2 é private → vê apenas as atribuídas a si (convDeptA_Private_AgentA)
    expect(convIds).toContain(convDeptA_Private_AgentA);

    // convDeptA_Private_AgentB: mesma dept, mesmo time, mas private → agentA NÃO deve ver
    expect(convIds).not.toContain(convDeptA_Private_AgentB);

    // Dept B: agentA não pertence → não vê
    expect(convIds).not.toContain(convDeptB);

    // Sem dept: não vê
    expect(convIds).not.toContain(convNoDept);
  });

  it('AGENT B vê dept A (team A2 private, só as suas) e dept B (team B shared)', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Cookie', agentBCookie);
    expect(res.status).toBe(200);
    const convIds = ids(res.body as { conversations: Array<{ id: string }> });

    // Team A2 private → agentB só vê a atribuída a si (convDeptA_Private_AgentB)
    expect(convIds).toContain(convDeptA_Private_AgentB);

    // Team B shared → vê todas (convDeptB)
    expect(convIds).toContain(convDeptB);

    // convDeptA_Shared: agentB não está no team A1 → não enxerga via dept (mas dept A está visível via teamA2)
    // Porém convDeptA_Shared está em teamA1 (shared) — agentB pertence ao dept A via teamA2,
    // então o dept A fica visível; convDeptA_Shared é teamA1 com peer=inherit→shared, visível por qualquer membro do dept
    // Mas agentB NÃO é membro do teamA1 → o filtro de dept é pelo dept_id, não pelo team_id
    // buildVisibilityPredicate usa dept_id para eixo 1; convDeptA_Shared.dept_id = deptA → visível
    // mas o eixo 2 peer: teamA1 peer=inherit→workspace default=shared → qualquer membro do dept vê
    expect(convIds).toContain(convDeptA_Shared);

    // convDeptA_Private_AgentA: teamA2 private, atribuída ao agentA → agentB não vê
    expect(convIds).not.toContain(convDeptA_Private_AgentA);

    // Sem dept: não vê
    expect(convIds).not.toContain(convNoDept);
  });

  it('AGENT sem dept (agent C) não vê nenhuma conversa (exceto as atribuídas a si)', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Cookie', agentCCookie);
    expect(res.status).toBe(200);
    const convIds = ids(res.body as { conversations: Array<{ id: string }> });
    // agentC não pertence a nenhum dept e não tem conversas atribuídas
    // O predicado permite "conversations.assigned_to = memberId" como fallback para AGENT
    expect(convIds).not.toContain(convDeptA_Shared);
    expect(convIds).not.toContain(convDeptA_Private_AgentA);
    expect(convIds).not.toContain(convDeptA_Private_AgentB);
    expect(convIds).not.toContain(convDeptB);
    expect(convIds).not.toContain(convNoDept);
  });
});

// ─── Override por membro ──────────────────────────────────────────────────────

describe('Override de visibilidade por membro', () => {
  it('override em dept B concede visibilidade extra ao agent C', async () => {
    // Insert override: agentC ganha acesso ao dept B
    const agentCRow = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.email, agentCEmail));
    const agentCId = agentCRow[0]?.id;
    if (!agentCId) throw new Error('agentC não encontrado.');

    await db.insert(schema.memberVisibilityOverrides).values({
      workspaceId: wsId,
      memberId: agentCId,
      departmentId: deptBId,
    });

    // Invalida o cache do workspace para que o override seja refletido
    // (o insert foi feito via getDb() direto, sem passar pelo middleware que faria o bump).
    await bumpVersion(`hm:ws:v:${wsId}`);

    try {
      const res = await request(app)
        .get('/api/conversations')
        .set('Cookie', agentCCookie);
      expect(res.status).toBe(200);
      const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
        (c) => c.id,
      );
      // Com override, agentC vê dept B
      expect(convIds).toContain(convDeptB);
      // Mas ainda não vê dept A (sem override para dept A)
      expect(convIds).not.toContain(convDeptA_Shared);
    } finally {
      // Limpar override para não afetar outros testes
      await db.delete(schema.memberVisibilityOverrides).where(
        eq(schema.memberVisibilityOverrides.memberId, agentCId),
      );
    }
  });
});

// ─── Filtros de distribuição ──────────────────────────────────────────────────

describe('Filtros de distribuição (department / team / assigned)', () => {
  it('filtro ?department= restringe ao dept especificado (ADMIN)', async () => {
    const res = await request(app)
      .get(`/api/conversations?department=${deptAId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).toContain(convDeptA_Private_AgentB);
    expect(convIds).not.toContain(convDeptB);
    expect(convIds).not.toContain(convNoDept);
  });

  it('filtro ?team= restringe ao time especificado (ADMIN)', async () => {
    const res = await request(app)
      .get(`/api/conversations?team=${teamA2Id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).toContain(convDeptA_Private_AgentB);
    expect(convIds).not.toContain(convDeptA_Shared); // team A1, não A2
    expect(convIds).not.toContain(convDeptB);
  });

  it('filtro ?assigned=me retorna só as conversas do membro autenticado (AGENT A)', async () => {
    const res = await request(app)
      .get('/api/conversations?assigned=me')
      .set('Cookie', agentACookie);
    expect(res.status).toBe(200);
    const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    // agentA tem convDeptA_Shared e convDeptA_Private_AgentA atribuídas a si
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    // Não atribuídas a agentA
    expect(convIds).not.toContain(convDeptA_Private_AgentB);
    expect(convIds).not.toContain(convDeptB);
  });

  it('filtro ?assigned=others retorna conversas atribuídas a outros (ADMIN)', async () => {
    const res = await request(app)
      .get('/api/conversations?assigned=others')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    // Conversas atribuídas a agentA e agentB (não ao admin)
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).toContain(convDeptA_Private_AgentB);
    expect(convIds).toContain(convDeptB);
    // convNoDept: sem atribuição → não aparece em "others"
    expect(convIds).not.toContain(convNoDept);
  });

  it('filtro ?assigned=<uuid> retorna conversas atribuídas ao uuid especificado (ADMIN)', async () => {
    const res = await request(app)
      .get(`/api/conversations?assigned=${agentAMemberId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const convIds = (res.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    expect(convIds).toContain(convDeptA_Shared);
    expect(convIds).toContain(convDeptA_Private_AgentA);
    expect(convIds).not.toContain(convDeptA_Private_AgentB);
    expect(convIds).not.toContain(convDeptB);
  });

  it('filtro ?assigned=invalido retorna 400', async () => {
    const res = await request(app)
      .get('/api/conversations?assigned=invalido')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

// ─── Cache isolation ──────────────────────────────────────────────────────────

describe('Cache key isolada por membro', () => {
  it('cache key de ADMIN é diferente da cache key de AGENT A (sem vazamento)', async () => {
    // Faz request como ADMIN
    const resAdmin = await request(app)
      .get('/api/conversations')
      .set('Cookie', adminCookie);
    expect(resAdmin.status).toBe(200);
    const adminIds = (resAdmin.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );

    // Faz request como AGENT A imediatamente depois
    const resAgent = await request(app)
      .get('/api/conversations')
      .set('Cookie', agentACookie);
    expect(resAgent.status).toBe(200);
    const agentIds = (resAgent.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );

    // ADMIN vê mais conversas que AGENT A (não deve ter recebido a lista do ADMIN)
    expect(adminIds.length).toBeGreaterThan(agentIds.length);
    // AGENT A não deve ver convDeptB (só visível ao dept B / dept A não via dept B)
    expect(agentIds).not.toContain(convDeptB);
    // ADMIN vê convDeptB
    expect(adminIds).toContain(convDeptB);
  });
});

// ─── GET /api/conversations/:id — detalhe do cockpit (F30-S03) ────────────────
describe('GET /api/conversations/:id — detalhe (cockpit)', () => {
  it('ADMIN em conversa visível → 200 com os campos do cockpit', async () => {
    const res = await request(app)
      .get(`/api/conversations/${convDeptB}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const conv = (res.body as { conversation: Record<string, unknown> }).conversation;
    expect(conv['id']).toBe(convDeptB);
    // Campos consumidos pelo ContactInfoPanel / ConversationHeader.
    expect(conv).toHaveProperty('status');
    expect(conv).toHaveProperty('aiMode');
    expect(conv).toHaveProperty('channelProvider');
    expect(conv).toHaveProperty('departmentName');
    expect(conv).toHaveProperty('assignedToName');
    expect(conv).toHaveProperty('agentName');
    expect(conv).toHaveProperty('stageName');
  });

  it('conversa inexistente → 404', async () => {
    const res = await request(app)
      .get('/api/conversations/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/conversations/routing-targets — alvos de roteamento (cockpit) ────
describe('GET /api/conversations/routing-targets', () => {
  it('sem sessão → 401', async () => {
    expect((await request(app).get('/api/conversations/routing-targets')).status).toBe(401);
  });

  it('STAFF → 200 com members[] + departments[]', async () => {
    const res = await request(app)
      .get('/api/conversations/routing-targets')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const body = res.body as { members: unknown[]; departments: unknown[] };
    expect(Array.isArray(body.members)).toBe(true);
    expect(Array.isArray(body.departments)).toBe(true);
  });

  it('não é capturado pela rota /:id (precedência de rota)', async () => {
    // Se /:id viesse antes, "routing-targets" seria tratado como id → 404.
    const res = await request(app)
      .get('/api/conversations/routing-targets')
      .set('Cookie', adminCookie);
    expect(res.status).not.toBe(404);
  });
});

// ─── S07.1 — guard de visibilidade por-conversa (endpoints por-id) ────────────
//
// Fecha o IDOR: a lista esconde a linha, mas o ACESSO por id também precisa negar
// quem não enxerga a conversa (read e write). 404 = não confirma existência.
describe('S07.1 — visibilidade nos endpoints por-id (404 para invisível)', () => {
  // AGENT A não enxerga convDeptA_Private_AgentB (mesmo time private, conv do colega).
  describe('AGENT A em conversa do colega (private) → 404', () => {
    it('GET /:id/messages → 404', async () => {
      const res = await request(app)
        .get(`/api/conversations/${convDeptA_Private_AgentB}/messages`)
        .set('Cookie', agentACookie);
      expect(res.status).toBe(404);
    });

    it('GET /:id (detalhe) → 404', async () => {
      const res = await request(app)
        .get(`/api/conversations/${convDeptA_Private_AgentB}`)
        .set('Cookie', agentACookie);
      expect(res.status).toBe(404);
    });

    it('GET /:id/notes → 404', async () => {
      const res = await request(app)
        .get(`/api/conversations/${convDeptA_Private_AgentB}/notes`)
        .set('Cookie', agentACookie);
      expect(res.status).toBe(404);
    });

    it('GET /:id/window → 404', async () => {
      const res = await request(app)
        .get(`/api/conversations/${convDeptA_Private_AgentB}/window`)
        .set('Cookie', agentACookie);
      expect(res.status).toBe(404);
    });

    it('GET /:id/routing/history → 404', async () => {
      const res = await request(app)
        .get(`/api/conversations/${convDeptA_Private_AgentB}/routing/history`)
        .set('Cookie', agentACookie);
      expect(res.status).toBe(404);
    });

    it('POST /:id/assign → 404 (write-path fechado, sem efeito)', async () => {
      const res = await request(app)
        .post(`/api/conversations/${convDeptA_Private_AgentB}/assign`)
        .set('Cookie', agentACookie)
        .send({ memberId: agentAMemberId });
      expect(res.status).toBe(404);
    });

    it('POST /:id/transfer → 404 (write-path fechado, sem efeito)', async () => {
      const res = await request(app)
        .post(`/api/conversations/${convDeptA_Private_AgentB}/transfer`)
        .set('Cookie', agentACookie)
        .send({ departmentId: deptBId });
      expect(res.status).toBe(404);
    });
  });

  // SUPERVISOR lidera só o dept A → não enxerga convDeptB.
  it('SUPERVISOR em conversa de dept que não lidera (dept B) → 404 (messages)', async () => {
    const res = await request(app)
      .get(`/api/conversations/${convDeptB}/messages`)
      .set('Cookie', supCookie);
    expect(res.status).toBe(404);
  });

  // Controles positivos: quem enxerga acessa normalmente.
  it('AGENT A na sua própria conversa private → 200 (messages)', async () => {
    const res = await request(app)
      .get(`/api/conversations/${convDeptA_Private_AgentA}/messages`)
      .set('Cookie', agentACookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('messages');
  });

  it('ADMIN vê qualquer conversa do workspace → 200 (notes em convDeptB)', async () => {
    const res = await request(app)
      .get(`/api/conversations/${convDeptB}/notes`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('notes');
  });
});
