/**
 * F70-S08 — teste permanente da cópia de atribuição de anúncio para o deal (F70-S07).
 *
 * Os dois caminhos que criam deal a partir de uma conversa herdam o anúncio que a
 * trouxe (`loadConversationAdAttribution`):
 *  - `ensureDealForConversation` (rota `POST /api/conversations/:id/deal`),
 *  - `POST /api/deals` com `conversationId`.
 *
 * Regras provadas contra o Postgres dev (RLS real, `withWorkspace`):
 *  - vence o PRIMEIRO referral pelo horário do provider (`provider_timestamp`), não
 *    a ordem de inserção nem o referral mais recente;
 *  - mensagem inbound sem referral antes dele não atrapalha;
 *  - referral inválido no jsonb é ignorado (revalidação com `readAdReferral`);
 *  - referral em mensagem OUTBOUND não conta;
 *  - conversa sem referral → deal com todas as colunas `ad_*` nulas;
 *  - deal criado sem `conversationId` → sem `ad_*`.
 *
 * Auth mockada com a mesma estratégia fiel de `deal-conversation.test.ts`:
 * `requireRole` usa o `can()` REAL e `withRLS` injeta `req.scoped` = `withWorkspace`.
 * Skip automático se o Postgres dev não estiver acessível.
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
    ) => withWorkspace(wsId, fn as never);
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

const { createDealConversationRouter, ensureDealForConversation, loadConversationAdAttribution } =
  await import('./deal-conversation');
const { createDealsCrudRouter } = await import('../deals/crud');

const app = express();
app.use(express.json());
// Mesma ordem de app.ts: pipeline → deals.
app.use(createDealConversationRouter());
app.use(createDealsCrudRouter());

// ── Fixtures ────────────────────────────────────────────────────────────────
const WS = randomUUID();
const MEMBER = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();
const sfx = WS.slice(0, 8);

let dbAvailable = true;

type Direction = 'inbound' | 'outbound';

interface SeedMessage {
  readonly direction?: Direction;
  readonly at: string;
  readonly adReferral?: unknown;
}

/** Referral normalizado (o shape que os parsers WA/IG gravam em `metadata.adReferral`). */
function ref(sourceId: string, clid: string, at: string): Record<string, unknown> {
  return {
    channel: 'meta_whatsapp',
    sourceType: 'ad',
    sourceId,
    headline: 'Anúncio ' + sourceId,
    ctwaClid: clid,
    referredAt: at,
  };
}

/** Conversa nova com as mensagens dadas, inseridas NA ORDEM do array. */
async function conversationWith(msgs: readonly SeedMessage[]): Promise<string> {
  const id = randomUUID();
  const db = getDb();
  await db.insert(schema.conversations).values({
    id,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: `r-${id.slice(0, 12)}`,
    origin: msgs.some((m) => m.adReferral !== undefined) ? 'origem:anuncio' : 'sem-origem',
  });
  for (const m of msgs) {
    const direction = m.direction ?? 'inbound';
    await db.insert(schema.messages).values({
      workspaceId: WS,
      conversationId: id,
      externalId: `m-${randomUUID().slice(0, 12)}`,
      direction,
      senderType: direction === 'inbound' ? 'contact' : 'member',
      type: 'text',
      content: 'msg ' + m.at,
      providerTimestamp: new Date(m.at),
      ...(m.adReferral !== undefined ? { metadata: { adReferral: m.adReferral } } : {}),
    });
  }
  return id;
}

const AD_COLUMNS = [
  'adChannel',
  'adSourceType',
  'adSourceId',
  'adSourceUrl',
  'adHeadline',
  'adBody',
  'adMediaType',
  'adCtwaClid',
  'adReferredAt',
] as const;

function expectNoAttribution(deal: Record<string, unknown> | null | undefined): void {
  expect(deal).toBeTruthy();
  for (const col of AD_COLUMNS) expect(deal?.[col] ?? null).toBeNull();
}

beforeAll(async () => {
  try {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S08 deal', slug: `f70s08-deal-${sfx}` });
    await db.insert(schema.members).values({
      id: MEMBER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `m-${MEMBER.slice(0, 8)}@x.test`,
      role: 'OWNER',
      status: 'active',
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S08',
      phoneNumberId: `PN_F70S08_${sfx}`,
      wabaId: `WABA_F70S08_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'Lead Anúncio',
      phone: '+55119' + sfx.replace(/\D/g, '3').padEnd(8, '3').slice(0, 8),
    });
    await db.insert(schema.pipelines).values({ id: PIPELINE, workspaceId: WS, name: 'Funil', isDefault: true });
    await db.insert(schema.stages).values({ id: STAGE, workspaceId: WS, pipelineId: PIPELINE, name: 'Novo', position: 0 });
  } catch (err) {
    dbAvailable = false;
    console.warn('[deal-attribution.test] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    const db = getDb();
    await db.delete(schema.dealHistory).where(eq(schema.dealHistory.workspaceId, WS));
    await db.delete(schema.deals).where(eq(schema.deals.workspaceId, WS));
    await db.delete(schema.messages).where(eq(schema.messages.workspaceId, WS));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

/**
 * Conversa de anúncio com ordem de INSERÇÃO embaralhada de propósito: o 2º anúncio
 * entra primeiro, depois uma mensagem sem referral mais antiga, depois o 1º anúncio.
 * Também um referral inválido (mais antigo que todos) e um referral em outbound.
 */
function adConversation(): Promise<string> {
  return conversationWith([
    { at: '2026-09-02T10:00:00Z', adReferral: ref('222', 'CLID_2', '2026-09-02T10:00:00Z') },
    { at: '2026-08-31T10:00:00Z' },
    { at: '2026-08-30T10:00:00Z', adReferral: { lixo: true } },
    {
      direction: 'outbound',
      at: '2026-08-29T10:00:00Z',
      adReferral: ref('999', 'CLID_OUT', '2026-08-29T10:00:00Z'),
    },
    { at: '2026-09-01T10:00:00Z', adReferral: ref('111', 'CLID_1', '2026-09-01T10:00:00Z') },
  ]);
}

function expectFirstTouch(deal: Record<string, unknown> | null | undefined): void {
  expect(deal).toMatchObject({
    adChannel: 'meta_whatsapp',
    adSourceType: 'ad',
    adSourceId: '111',
    adCtwaClid: 'CLID_1',
    adHeadline: 'Anúncio 111',
  });
  const at = deal?.['adReferredAt'];
  expect(at instanceof Date ? at.toISOString() : at).toBe('2026-09-01T10:00:00.000Z');
}

describe('loadConversationAdAttribution', () => {
  maybe('primeiro referral inbound válido pelo horário do provider', async () => {
    const conv = await adConversation();
    const cols = await withWorkspace(WS, (tx) => loadConversationAdAttribution(tx, conv));
    expect(cols).toMatchObject({ adSourceId: '111', adCtwaClid: 'CLID_1' });
  });

  maybe('conversa sem referral → null', async () => {
    const conv = await conversationWith([{ at: '2026-09-01T10:00:00Z' }]);
    const cols = await withWorkspace(WS, (tx) => loadConversationAdAttribution(tx, conv));
    expect(cols).toBeNull();
  });

  maybe('conversa só com referral em outbound → null', async () => {
    const conv = await conversationWith([
      { direction: 'outbound', at: '2026-09-01T10:00:00Z', adReferral: ref('9', 'C9', '2026-09-01T10:00:00Z') },
    ]);
    const cols = await withWorkspace(WS, (tx) => loadConversationAdAttribution(tx, conv));
    expect(cols).toBeNull();
  });
});

describe('ensureDealForConversation', () => {
  maybe('deal herda o primeiro toque da conversa', async () => {
    const conv = await adConversation();
    const deal = await withWorkspace(WS, (tx) => ensureDealForConversation(tx, conv, { workspaceId: WS }));
    expectFirstTouch(deal);
  });

  maybe('conversa sem referral → deal sem ad_*', async () => {
    const conv = await conversationWith([{ at: '2026-09-01T10:00:00Z' }]);
    const deal = await withWorkspace(WS, (tx) => ensureDealForConversation(tx, conv, { workspaceId: WS }));
    expectNoAttribution(deal);
  });

  maybe('rota POST /api/conversations/:id/deal grava ad_* no banco', async () => {
    const conv = await adConversation();
    const res = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(res.status).toBe(201);
    const [row] = await getDb().select().from(schema.deals).where(eq(schema.deals.id, res.body.deal.id));
    expectFirstTouch(row);
  });
});

describe('POST /api/deals com conversationId', () => {
  function body(conversationId?: string): Record<string, unknown> {
    return {
      pipelineId: PIPELINE,
      stageId: STAGE,
      contactId: CONTACT,
      title: 'Deal F70-S08',
      ...(conversationId !== undefined ? { conversationId } : {}),
    };
  }

  async function dealRow(id: unknown) {
    expect(typeof id).toBe('string');
    const [row] = await getDb()
      .select()
      .from(schema.deals)
      .where(eq(schema.deals.id, String(id)));
    return row;
  }

  function createdId(res: request.Response): unknown {
    const payload: unknown = res.body;
    if (typeof payload !== 'object' || payload === null) return undefined;
    const deal = (payload as { deal?: { id?: unknown } }).deal;
    return deal?.id ?? (payload as { id?: unknown }).id;
  }

  maybe('conversa de anúncio → primeiro toque no deal', async () => {
    const conv = await adConversation();
    const res = await request(app).post('/api/deals').send(body(conv));
    expect(res.status).toBe(201);
    expectFirstTouch(await dealRow(createdId(res)));
  });

  maybe('conversa sem referral → deal sem ad_*', async () => {
    const conv = await conversationWith([{ at: '2026-09-01T10:00:00Z' }]);
    const res = await request(app).post('/api/deals').send(body(conv));
    expect(res.status).toBe(201);
    expectNoAttribution(await dealRow(createdId(res)));
  });

  maybe('sem conversationId → deal sem ad_*', async () => {
    const res = await request(app).post('/api/deals').send(body());
    expect(res.status).toBe(201);
    expectNoAttribution(await dealRow(createdId(res)));
  });
});
