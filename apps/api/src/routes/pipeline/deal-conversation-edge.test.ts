/**
 * F47-S11 (QA) — Edge cases e escrutínio arquitetural do card-da-conversa (S04).
 *
 * Complementa deal-conversation.test.ts (happy path + idempotência sequencial)
 * cobrindo o que o QA caçou:
 *
 *  1. ESCRUTÍNIO ARQUITETURAL — o S04 monta um `GET /api/deals/:id` "shadow"
 *     (router de pipeline, ANTES do canônico em deals/crud, espelhando app.ts).
 *     Provamos que o shadow GANHA (retorna `{ deal, contact }`, não o bare `{ deal }`
 *     do canônico) e que os pré-handlers `close-won`/`close-lost` NÃO quebram o
 *     close canônico — o `next()` atravessa o sub-router e chega no handler real
 *     (deal fica closed E o snapshot é gravado na mesma requisição).
 *
 *  2. IDEMPOTÊNCIA SOB CONCORRÊNCIA (F47-S12) — o unique parcial
 *     `uq_deals_conversation` (deals.conversation_id WHERE NOT NULL) + o catch de
 *     23505 em `ensureDealForConversation` fecham a race: a requisição perdedora
 *     re-lê o deal vencedor. Duas chamadas SIMULTÂNEAS = EXATAMENTE 1 deal, sem 500.
 *
 *  3. SNAPSHOT DEGRADADO — deal cujo contato tem cadastro vazio (address {}, sem
 *     document) ainda grava um snapshot bem-formado no fechamento (sem explodir).
 *
 *  4. SEM PIPELINE/STAGE — 422 honesto (no_default_pipeline), nunca 500.
 *
 * Mesma estratégia de mocks fiéis de auth + Postgres dev real. Skip se DB off.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';

interface Session {
  workspaceId: string;
  memberId: string;
  role: Role;
}
let session: Session | null = null;

/**
 * Injeção de falha controlada no `req.scoped` (F47-S13 bug_012). Quando >0, as
 * próximas N invocações de `req.scoped(fn)` rejeitam em vez de rodar a tx real —
 * usado para provar que a falha do snapshot (best-effort) não derruba o close.
 */
let scopedFailCount = 0;

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!session) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: session.workspaceId },
      member: { id: session.memberId, role: session.role },
    } as express.Request['auth'];
    next();
  },
  withRLS: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    const wsId = req.auth.workspace.id;
    (req as unknown as { scoped: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).scoped = (
      fn,
    ) => {
      if (scopedFailCount > 0) {
        scopedFailCount -= 1;
        return Promise.reject(new Error('scoped boom (fault-injected)'));
      }
      return withWorkspace(wsId, fn as never);
    };
    next();
  },
  requireRole:
    (perm: Permission) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.auth?.member.role as Role | undefined;
      if (!role || !can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

const { createDealConversationRouter } = await import('./deal-conversation');
const { createDealsCrudRouter } = await import('../deals/crud');

// Ordem fiel a app.ts: pipeline (POST do card + pré-handler de snapshot) ANTES de deals/crud.
const app = express();
app.use(express.json());
app.use(createDealConversationRouter());
app.use(createDealsCrudRouter());

// App "só canônico" (sem o pipeline) p/ provar que o GET consolidado é a fonte única.
const canonicalOnly = express();
canonicalOnly.use(express.json());
canonicalOnly.use(createDealsCrudRouter());

const WS = randomUUID();
const MEMBER = randomUUID();
const CONTACT = randomUUID();
const CONTACT_EMPTY = randomUUID();
const CHANNEL = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();

// Workspace SEM pipeline/stage — p/ provar o 422 honesto do auto-create.
const WS_NO_PIPE = randomUUID();
const MEMBER_NO_PIPE = randomUUID();
const CONTACT_NO_PIPE = randomUUID();
const CHANNEL_NO_PIPE = randomUUID();

let dbAvailable = true;

async function seedWorkspace(wsId: string, slug: string): Promise<void> {
  await getDb().insert(schema.workspaces).values({ id: wsId, name: `WS ${slug}`, slug });
}

beforeAll(async () => {
  try {
    await seedWorkspace(WS, `f47s11-${WS.slice(0, 8)}`);
    await seedWorkspace(WS_NO_PIPE, `f47s11n-${WS_NO_PIPE.slice(0, 8)}`);
    const db = getDb();
    await db.insert(schema.members).values([
      {
        id: MEMBER,
        workspaceId: WS,
        authUserId: randomUUID(),
        email: `m-${MEMBER.slice(0, 8)}@x.test`,
        role: 'OWNER',
        status: 'active',
      },
      {
        id: MEMBER_NO_PIPE,
        workspaceId: WS_NO_PIPE,
        authUserId: randomUUID(),
        email: `m-${MEMBER_NO_PIPE.slice(0, 8)}@x.test`,
        role: 'OWNER',
        status: 'active',
      },
    ]);
    await db.insert(schema.contacts).values([
      {
        id: CONTACT,
        workspaceId: WS,
        displayName: 'Maria Souza',
        phone: '+5511999990000',
        document: '12345678901',
        address: { city: 'São Paulo', state: 'SP', cep: '01001-000' },
      },
      // Contato com cadastro vazio (address {} default, sem document).
      { id: CONTACT_EMPTY, workspaceId: WS, displayName: 'Sem Cadastro' },
      { id: CONTACT_NO_PIPE, workspaceId: WS_NO_PIPE, displayName: 'Lead órfão' },
    ]);
    await db.insert(schema.channels).values([
      {
        id: CHANNEL,
        workspaceId: WS,
        provider: 'waha',
        name: 'Canal',
        wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
      },
      {
        id: CHANNEL_NO_PIPE,
        workspaceId: WS_NO_PIPE,
        provider: 'waha',
        name: 'Canal órfão',
        wahaSessionId: `s-${CHANNEL_NO_PIPE.slice(0, 8)}`,
      },
    ]);
    await db
      .insert(schema.pipelines)
      .values({ id: PIPELINE, workspaceId: WS, name: 'Funil', isDefault: true });
    await db
      .insert(schema.stages)
      .values({ id: STAGE, workspaceId: WS, pipelineId: PIPELINE, name: 'Novo', position: 0 });
    // WS_NO_PIPE: de propósito, NENHUM pipeline/stage.
  } catch (err) {
    dbAvailable = false;
    console.warn('[deal-conversation-edge.test] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS_NO_PIPE));
  }
  await closeDb();
});

async function freshConversation(contactId = CONTACT, wsId = WS, channelId = CHANNEL): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.conversations)
    .values({ id, workspaceId: wsId, channelId, contactId, remoteId: `r-${id.slice(0, 12)}` });
  return id;
}

async function dealsForConversation(conversationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(eq(schema.deals.conversationId, conversationId));
  return rows.map((r) => r.id);
}

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
  scopedFailCount = 0;
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

// ── 1. GET /api/deals/:id CONSOLIDADO no canônico (deals/crud) — F47-S15 ──────
// O shadow em pipeline foi removido; o handler canônico é a fonte única e já
// anexa o cadastro vivo do contato (read-through) via `loadContactReadThrough`.
describe('GET /api/deals/:id — canônico consolidado (deal + cadastro read-through)', () => {
  maybe('app completo: resposta inclui `contact` (read-through)', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    const res = await request(app).get(`/api/deals/${dealId}`);
    expect(res.status).toBe(200);
    expect(res.body.deal.id).toBe(dealId);
    expect(res.body.contact).toBeTruthy();
    expect(res.body.contact.document).toBe('12345678901');
  });

  maybe('canônico isolado também devolve { deal, contact } (sem shadow)', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    // Sem o router de pipeline montado: o canônico (deals/crud) é a ÚNICA fonte e
    // já entrega o read-through enriquecido — prova a consolidação (shadow removido).
    const res = await request(canonicalOnly).get(`/api/deals/${dealId}`);
    expect(res.status).toBe(200);
    expect(res.body.deal.id).toBe(dealId);
    expect(res.body.contact).toBeTruthy();
  });
});

// ── 1c. Picker de pipeline: POST escolhe onde ancorar o card (F47-S15) ───────
describe('POST /api/conversations/:id/deal — picker de pipeline', () => {
  maybe('cria o card no pipeline/estágio escolhidos', async () => {
    const db = getDb();
    const altPipeline = randomUUID();
    const altStage = randomUUID();
    await db
      .insert(schema.pipelines)
      .values({ id: altPipeline, workspaceId: WS, name: 'Funil B', isDefault: false });
    await db
      .insert(schema.stages)
      .values({ id: altStage, workspaceId: WS, pipelineId: altPipeline, name: 'Entrada B', position: 0 });

    const conv = await freshConversation();
    const res = await request(app)
      .post(`/api/conversations/${conv}/deal`)
      .send({ pipelineId: altPipeline, stageId: altStage });
    expect(res.status).toBe(201);
    expect(res.body.deal.pipelineId).toBe(altPipeline);
    expect(res.body.deal.stageId).toBe(altStage);
  });

  maybe('sem pipelineId cai no pipeline default', async () => {
    const conv = await freshConversation();
    const res = await request(app).post(`/api/conversations/${conv}/deal`).send({});
    expect(res.status).toBe(201);
    expect(res.body.deal.pipelineId).toBe(PIPELINE);
  });

  maybe('pipelineId malformado (não-uuid) → 400', async () => {
    const conv = await freshConversation();
    const res = await request(app)
      .post(`/api/conversations/${conv}/deal`)
      .send({ pipelineId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});

// ── 1b. Pré-handler de snapshot NÃO quebra o close canônico ──────────────────
describe('close-won/close-lost — pré-handler atravessa p/ o close canônico', () => {
  maybe('close-won: deal fica fechado E snapshot gravado na MESMA request', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    const close = await request(app).post(`/api/deals/${dealId}/close-won`);
    // O close canônico respondeu (status 200 + closedWon=true) — o pré-handler
    // chamou next() corretamente.
    expect(close.status).toBe(200);
    expect(close.body.deal.closedWon).toBe(true);
    expect(close.body.deal.closedAt).toBeTruthy();

    // E o snapshot foi gravado (pré-handler) — ambos os efeitos na mesma request.
    const [row] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect((row?.cf as Record<string, unknown>)['contact_snapshot']).toBeTruthy();
  });

  maybe('close-won de deal inexistente -> 404 (canônico decide; pré-handler só segue)', async () => {
    const res = await request(app).post(`/api/deals/${randomUUID()}/close-won`);
    expect(res.status).toBe(404);
  });

  // ── 1c. Re-close PRESERVA o snapshot original (F47-S13 bug_012) ──────────────
  maybe('re-close (reopen + close de novo) preserva o snapshot do 1º fechamento', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    // 1º close grava o snapshot com o cadastro vigente.
    await request(app).post(`/api/deals/${dealId}/close-won`);
    const [first] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    const firstSnap = (first?.cf as Record<string, unknown>)['contact_snapshot'] as Record<
      string,
      unknown
    >;
    expect(firstSnap).toBeTruthy();
    const firstCapturedAt = firstSnap['capturedAt'];

    // Muda o cadastro VIVO do contato APÓS o 1º close.
    await getDb()
      .update(schema.contacts)
      .set({ displayName: 'Nome Alterado Pós-Venda', document: '99988877766' })
      .where(eq(schema.contacts.id, CONTACT));

    // Reabre e fecha de novo — o pré-handler de snapshot roda outra vez.
    await request(app).post(`/api/deals/${dealId}/reopen`);
    const reclose = await request(app).post(`/api/deals/${dealId}/close-won`);
    expect(reclose.status).toBe(200);

    // O snapshot PRESERVA o estado da venda original (guard): NÃO foi sobrescrito
    // com o cadastro atual.
    const [second] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    const secondSnap = (second?.cf as Record<string, unknown>)['contact_snapshot'] as Record<
      string,
      unknown
    >;
    expect(secondSnap['capturedAt']).toBe(firstCapturedAt);
    expect(secondSnap['displayName']).toBe(firstSnap['displayName']);
    expect(secondSnap['displayName']).not.toBe('Nome Alterado Pós-Venda');

    // Restaura o contato para não contaminar os demais testes do WS compartilhado.
    await getDb()
      .update(schema.contacts)
      .set({ displayName: 'Maria Souza', document: '12345678901' })
      .where(eq(schema.contacts.id, CONTACT));
  });

  // ── 1d. Falha do snapshot NÃO bloqueia o close (F47-S13 bug_012) ────────────
  maybe('snapshot que falha não derruba o close (best-effort, try/catch)', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    // Falha-injeta a 1ª invocação de req.scoped da requisição de close: ela é a do
    // pré-handler de SNAPSHOT. A 2ª invocação (close canônico em deals/crud) roda
    // normal. Sem o try/catch no pré-handler, a rejeição viraria 500 e o deal NUNCA
    // fecharia.
    scopedFailCount = 1;
    const close = await request(app).post(`/api/deals/${dealId}/close-won`);
    expect(close.status).toBe(200);
    expect(close.body.deal.closedWon).toBe(true);
    expect(close.body.deal.closedAt).toBeTruthy();

    // O snapshot falhou de propósito -> não foi gravado, mas o close persistiu.
    const [row] = await getDb()
      .select({ cf: schema.deals.customFields, closedWon: schema.deals.closedWon })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect(row?.closedWon).toBe(true);
    expect((row?.cf as Record<string, unknown>)['contact_snapshot']).toBeUndefined();
  });
});

// ── 2. Idempotência sob CONCORRÊNCIA (race FECHADA em F47-S12) ────────────────
describe('POST /api/conversations/:id/deal — concorrência', () => {
  maybe(
    'duas chamadas SIMULTÂNEAS resultam em EXATAMENTE 1 deal, sem 500 (race fechada)',
    async () => {
      const conv = await freshConversation();
      const [a, b] = await Promise.all([
        request(app).post(`/api/conversations/${conv}/deal`),
        request(app).post(`/api/conversations/${conv}/deal`),
      ]);
      // O unique parcial `uq_deals_conversation` + catch de 23505 garantem que a
      // requisição perdedora re-lê o deal vencedor em vez de explodir: ambas 201,
      // nenhuma 500. (F47-S12)
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.status).not.toBe(500);
      expect(b.status).not.toBe(500);
      // Ambas devolvem o MESMO deal (o vencedor da corrida).
      expect(a.body.deal.id).toBe(b.body.deal.id);

      // E o banco tem EXATAMENTE 1 deal para a conversa — idempotência real.
      const ids = await dealsForConversation(conv);
      expect(ids).toHaveLength(1);
    },
  );

  maybe('chamadas SEQUENCIAIS continuam idempotentes (1 deal)', async () => {
    const conv = await freshConversation();
    await request(app).post(`/api/conversations/${conv}/deal`);
    await request(app).post(`/api/conversations/${conv}/deal`);
    expect(await dealsForConversation(conv)).toHaveLength(1);
  });
});

// ── 3. Snapshot degradado (cadastro vazio) ───────────────────────────────────
describe('snapshot com cadastro vazio', () => {
  maybe('contato sem address/document ainda grava snapshot bem-formado', async () => {
    const conv = await freshConversation(CONTACT_EMPTY);
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    const close = await request(app).post(`/api/deals/${dealId}/close-won`);
    expect(close.status).toBe(200);

    const [row] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    const snap = (row?.cf as Record<string, unknown>)['contact_snapshot'] as Record<string, unknown>;
    expect(snap).toBeTruthy();
    expect(snap['contactId']).toBe(CONTACT_EMPTY);
    expect(snap['document']).toBeNull();
    // address default '{}' -> objeto vazio, não null.
    expect(snap['address']).toEqual({});
    expect(snap['capturedAt']).toBeTruthy();
  });
});

// ── 4. Sem pipeline/stage -> 422 honesto (nunca 500) ─────────────────────────
describe('auto-create sem pipeline configurado', () => {
  maybe('workspace sem pipeline/stage -> 422 no_default_pipeline', async () => {
    session = { workspaceId: WS_NO_PIPE, memberId: MEMBER_NO_PIPE, role: 'OWNER' };
    const conv = await freshConversation(CONTACT_NO_PIPE, WS_NO_PIPE, CHANNEL_NO_PIPE);
    const res = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('no_default_pipeline');
    // E nenhum deal foi criado (nada órfão no banco).
    expect(await dealsForConversation(conv)).toHaveLength(0);
  });
});
