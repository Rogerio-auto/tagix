/**
 * Integração real (Postgres dev) do versionamento de prompt do agente (F56-S31).
 *
 * Exercita o router REAL (`createAgentsCrudRouter`, que monta o versions router)
 * contra `@hm/db` REAL, com `req.scoped` = `withWorkspace(tenant)` — ou seja, a RLS
 * de verdade. Cobre o DoD:
 *   - criar draft → publicar (draft→live, aplica ao agente, arquiva a live anterior);
 *   - rollback (nova live a partir de uma versão antiga; histórico append-only);
 *   - diff entre versões;
 *   - hook do CRUD PATCH (editar o prompt grava uma nova live);
 *   - isolamento RLS cross-tenant (workspace B não enxerga versões/agente de A).
 *
 * Seed via `getDb()` (papel de conexão dev = bypass RLS); leitura/escrita de teste
 * via `withWorkspace` (papel `hm_app`, sujeito a RLS) — mesmo padrão de `rls.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace, type DbTx } from '@hm/db';

// Tenant/autor ativos — a mock de auth lê estes; trocamos p/ simular cross-tenant.
let activeWorkspaceId = '';
let activeMemberId = '';

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      workspace: { id: activeWorkspaceId },
      member: { id: activeMemberId, role: 'OWNER' },
    } as unknown as typeof req.auth;
    next();
  },
  withRLS: (req: Request, _res: Response, next: NextFunction) => {
    req.scoped = <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> =>
      withWorkspace(activeWorkspaceId, fn);
    next();
  },
  requireRole:
    () =>
    (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

const { createAgentsCrudRouter } = await import('./crud');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createAgentsCrudRouter());
  return app;
}

const app = makeApp();

// ── Fixtures reais ────────────────────────────────────────────────────────────
const wsA = randomUUID();
const wsB = randomUUID();
let memberA = '';
let memberB = '';
let agentA = '';
let agentB = '';

async function seedTenant(
  wsId: string,
  label: string,
): Promise<{ memberId: string; agentId: string }> {
  const db = getDb();
  await db.insert(schema.workspaces).values({
    id: wsId,
    name: `WS ${label}`,
    slug: `ws-${label}-${wsId.slice(0, 8)}`,
  });
  const [member] = await db
    .insert(schema.members)
    .values({
      workspaceId: wsId,
      authUserId: randomUUID(),
      email: `owner-${wsId.slice(0, 8)}@dev.local`,
      role: 'OWNER',
      status: 'active',
    })
    .returning({ id: schema.members.id });
  const [agent] = await db
    .insert(schema.agents)
    .values({
      workspaceId: wsId,
      name: `Agente ${label}`,
      systemPrompt: `Prompt base ${label}`,
      model: 'openai/gpt-4o-mini',
    })
    .returning({ id: schema.agents.id });
  if (!member || !agent) throw new Error('seed falhou');
  return { memberId: member.id, agentId: agent.id };
}

beforeAll(async () => {
  const a = await seedTenant(wsA, 'A');
  const b = await seedTenant(wsB, 'B');
  memberA = a.memberId;
  agentA = a.agentId;
  memberB = b.memberId;
  agentB = b.agentId;
});

afterAll(async () => {
  const db = getDb();
  // Cascade remove members/agents/agent_prompt_versions.
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsA));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, wsB));
  await closeDb();
});

function useTenantA() {
  activeWorkspaceId = wsA;
  activeMemberId = memberA;
}

describe('Versionamento de prompt — fluxo real (draft→live, rollback, diff)', () => {
  it('cria draft, publica (draft→live) e aplica ao agente', async () => {
    useTenantA();

    const draftRes = await request(app)
      .post(`/api/agents/${agentA}/versions`)
      .send({ systemPrompt: 'Você é o vendedor v1.', label: 'v1', model: 'openai/gpt-4o' });
    expect(draftRes.status).toBe(201);
    expect(draftRes.body.version.status).toBe('draft');
    expect(draftRes.body.version.version).toBe(1);
    const draftId = draftRes.body.version.id as string;

    // Ainda draft: o agente NÃO mudou.
    const agentBefore = await withWorkspace(wsA, (tx) =>
      tx.select({ p: schema.agents.systemPrompt }).from(schema.agents).where(eq(schema.agents.id, agentA)),
    );
    expect(agentBefore[0]?.p).toBe('Prompt base A');

    const pubRes = await request(app).post(`/api/agents/${agentA}/versions/${draftId}/publish`);
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.version.status).toBe('live');
    expect(pubRes.body.version.publishedAt).toBeTruthy();

    // Live aplicada ao agente (prompt + modelo).
    const agentAfter = await withWorkspace(wsA, (tx) =>
      tx
        .select({ p: schema.agents.systemPrompt, m: schema.agents.model })
        .from(schema.agents)
        .where(eq(schema.agents.id, agentA)),
    );
    expect(agentAfter[0]?.p).toBe('Você é o vendedor v1.');
    expect(agentAfter[0]?.m).toBe('openai/gpt-4o');
  });

  it('publicar uma segunda versão arquiva a live anterior (no máx. 1 live por agente)', async () => {
    useTenantA();

    const d2 = await request(app)
      .post(`/api/agents/${agentA}/versions`)
      .send({ systemPrompt: 'Você é o vendedor v2.', label: 'v2' });
    expect(d2.status).toBe(201);
    expect(d2.body.version.version).toBe(2);

    const pub2 = await request(app).post(`/api/agents/${agentA}/versions/${d2.body.version.id}/publish`);
    expect(pub2.status).toBe(200);

    const versions = await request(app).get(`/api/agents/${agentA}/versions`);
    expect(versions.status).toBe(200);
    const live = versions.body.versions.filter((v: { status: string }) => v.status === 'live');
    expect(live).toHaveLength(1);
    expect(live[0].version).toBe(2);
    // v1 foi arquivada.
    const v1 = versions.body.versions.find((v: { version: number }) => v.version === 1);
    expect(v1.status).toBe('archived');
  });

  it('rollback cria uma NOVA live a partir de uma versão antiga (append-only)', async () => {
    useTenantA();

    const list = await request(app).get(`/api/agents/${agentA}/versions`);
    const v1 = list.body.versions.find((v: { version: number }) => v.version === 1);
    expect(v1.status).toBe('archived');

    const rb = await request(app).post(`/api/agents/${agentA}/versions/${v1.id}/rollback`).send({});
    expect(rb.status).toBe(201);
    expect(rb.body.version.status).toBe('live');
    expect(rb.body.version.version).toBe(3); // nova versão, não muta a v1
    expect(rb.body.version.rolledBackFrom).toBe(1);

    // Agente voltou ao conteúdo da v1.
    const agentNow = await withWorkspace(wsA, (tx) =>
      tx.select({ p: schema.agents.systemPrompt }).from(schema.agents).where(eq(schema.agents.id, agentA)),
    );
    expect(agentNow[0]?.p).toBe('Você é o vendedor v1.');

    // v1 continua archived (histórico intacto).
    const after = await request(app).get(`/api/agents/${agentA}/versions`);
    const v1After = after.body.versions.find((v: { version: number }) => v.version === 1);
    expect(v1After.status).toBe('archived');
  });

  it('diff devolve as duas versões pedidas', async () => {
    useTenantA();
    const res = await request(app).get(`/api/agents/${agentA}/versions/diff?from=1&to=2`);
    expect(res.status).toBe(200);
    expect(res.body.from.version).toBe(1);
    expect(res.body.to.version).toBe(2);
    expect(res.body.from.systemPrompt).toBe('Você é o vendedor v1.');
    expect(res.body.to.systemPrompt).toBe('Você é o vendedor v2.');
  });

  it('só rascunhos são editáveis (publicada → 409)', async () => {
    useTenantA();
    const list = await request(app).get(`/api/agents/${agentA}/versions`);
    const live = list.body.versions.find((v: { status: string }) => v.status === 'live');
    const res = await request(app)
      .patch(`/api/agents/${agentA}/versions/${live.id}`)
      .send({ systemPrompt: 'tentando mutar a live' });
    expect(res.status).toBe(409);
  });

  it('hook do CRUD PATCH: editar o prompt grava uma nova live', async () => {
    useTenantA();
    const before = await request(app).get(`/api/agents/${agentA}/versions`);
    const maxBefore = Math.max(
      ...before.body.versions.map((v: { version: number }) => v.version),
    );

    const patchRes = await request(app)
      .patch(`/api/agents/${agentA}`)
      .send({ systemPrompt: 'Prompt editado direto no PATCH.' });
    expect(patchRes.status).toBe(200);

    const after = await request(app).get(`/api/agents/${agentA}/versions`);
    const live = after.body.versions.filter((v: { status: string }) => v.status === 'live');
    expect(live).toHaveLength(1);
    expect(live[0].version).toBe(maxBefore + 1);
    expect(live[0].systemPrompt).toBe('Prompt editado direto no PATCH.');
  });

  it('editar campo NÃO-cérebro (nome) não gera versão', async () => {
    useTenantA();
    const before = await request(app).get(`/api/agents/${agentA}/versions`);
    const countBefore = before.body.versions.length;

    const patchRes = await request(app).patch(`/api/agents/${agentA}`).send({ name: 'Novo nome' });
    expect(patchRes.status).toBe(200);

    const after = await request(app).get(`/api/agents/${agentA}/versions`);
    expect(after.body.versions.length).toBe(countBefore);
  });
});

describe('Versionamento de prompt — isolamento RLS cross-tenant', () => {
  it('workspace B não enxerga versões nem o agente de A (404)', async () => {
    // Tenant B ativo tentando ler o agente de A.
    activeWorkspaceId = wsB;
    activeMemberId = memberB;

    const list = await request(app).get(`/api/agents/${agentA}/versions`);
    expect(list.status).toBe(404);

    const draft = await request(app)
      .post(`/api/agents/${agentA}/versions`)
      .send({ systemPrompt: 'injeção cross-tenant' });
    expect(draft.status).toBe(404);

    const diff = await request(app).get(`/api/agents/${agentA}/versions/diff?from=1&to=2`);
    expect(diff.status).toBe(404);
  });

  it('agente de B tem seu próprio histórico, isolado de A', async () => {
    activeWorkspaceId = wsB;
    activeMemberId = memberB;

    const draft = await request(app)
      .post(`/api/agents/${agentB}/versions`)
      .send({ systemPrompt: 'Prompt de B v1.' });
    expect(draft.status).toBe(201);
    expect(draft.body.version.version).toBe(1); // numeração própria, não continua a de A

    // Nível DB: nenhuma linha de A visível sob o escopo de B.
    const rows = await withWorkspace(wsB, (tx) =>
      tx
        .select({ id: schema.agentPromptVersions.id })
        .from(schema.agentPromptVersions)
        .where(
          and(
            eq(schema.agentPromptVersions.agentId, agentA),
            eq(schema.agentPromptVersions.workspaceId, wsB),
          ),
        ),
    );
    expect(rows).toHaveLength(0);
  });
});
