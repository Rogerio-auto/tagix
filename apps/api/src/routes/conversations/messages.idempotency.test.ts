/**
 * F52-S04 — idempotência de envio na borda da API.
 *
 * Header `Idempotency-Key`: reenviar o MESMO POST (retry/duplo-clique) devolve a
 * mensagem já criada (200) sem duplicar INSERT nem enqueue. Sem o header, o
 * comportamento legado (sempre cria, 201) é preservado.
 *
 * Sem Docker/Postgres/RabbitMQ: `@hm/db`, `@hm/shared/mq` e o publisher são
 * mockados; o `tx` fake distingue lookup de conversa vs. de mensagem idempotente.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { assertVisibleMock } = vi.hoisted(() => ({ assertVisibleMock: vi.fn() }));
const { publishOutboundJobMock } = vi.hoisted(() => ({ publishOutboundJobMock: vi.fn() }));

const sendToQueueMock = vi.fn();
vi.mock('@hm/shared/mq', () => ({
  connectMq: vi.fn().mockResolvedValue({ channel: { sendToQueue: sendToQueueMock }, connection: {} }),
  makeEnvelope: (_t: string, _w: string, payload: unknown) => payload,
}));

vi.mock('../../mq/outbound-publisher', () => ({
  publishOutboundJob: (...args: unknown[]) => publishOutboundJobMock(...args),
}));

const CONV_ID = '00000000-0000-0000-0000-000000000c01';
const MEMBER_OWNER = '00000000-0000-0000-0000-000000000001';

/** Conversa em memória (aiMode off p/ não disparar evento de handoff). */
let convRow: { channelId: string; remoteId: string; aiMode: string } | null = {
  channelId: '00000000-0000-0000-0000-000000000a01',
  remoteId: '+5511999990001',
  aiMode: 'off',
};

/** Mensagem existente p/ o cenário de replay (null = não existe ainda). */
let existingMessage: Record<string, unknown> | null = null;
/** Captura dos valores do INSERT (asserção da chave gravada). */
let lastInsertValues: Record<string, unknown> | null = null;

const CREATED_MESSAGE = {
  id: '00000000-0000-0000-0000-000000000f01',
  conversationId: CONV_ID,
  content: 'oi',
  direction: 'outbound',
  outboundIdempotencyKey: null as string | null,
};

vi.mock('@hm/db', () => ({
  schema: {
    conversations: {
      __table: 'conversations',
      id: 'id',
      channelId: 'channelId',
      remoteId: 'remoteId',
      aiMode: 'aiMode',
      aiLastHumanAt: 'aiLastHumanAt',
      updatedAt: 'updatedAt',
    },
    messages: {
      __table: 'messages',
      id: 'id',
      workspaceId: 'workspaceId',
      conversationId: 'conversationId',
      outboundIdempotencyKey: 'outboundIdempotencyKey',
    },
    auditLogs: { workspaceId: 'workspaceId' },
  },
  assertConversationVisible: assertVisibleMock,
}));

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = {
      workspace: { id: 'ws-test' },
      member: { role: 'OWNER', id: MEMBER_OWNER },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(makeTx());
    next();
  },
  requireRole: (_perm: string) => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

type MockTx = ReturnType<typeof makeTx>;

function makeTx() {
  return {
    select: (_proj?: unknown) => ({
      from: (table: { __table?: string }) => ({
        where: () => ({
          limit: (_n: number) => {
            if (table.__table === 'messages') return existingMessage ? [existingMessage] : [];
            return convRow ? [convRow] : [];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        lastInsertValues = data;
        return {
          returning: () =>
            Promise.resolve([
              { ...CREATED_MESSAGE, outboundIdempotencyKey: data['outboundIdempotencyKey'] ?? null },
            ]),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (_data: unknown) => ({ where: (_c: unknown) => Promise.resolve() }),
    }),
  };
}

const { createMessagesRouter } = await import('./messages');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createMessagesRouter());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  assertVisibleMock.mockResolvedValue(true);
  publishOutboundJobMock.mockResolvedValue(true);
  existingMessage = null;
  lastInsertValues = null;
  convRow = {
    channelId: '00000000-0000-0000-0000-000000000a01',
    remoteId: '+5511999990001',
    aiMode: 'off',
  };
});

describe('POST /api/conversations/:id/messages — idempotência (F52-S04)', () => {
  it('com Idempotency-Key e mensagem já existente → 200 replay, sem enqueue', async () => {
    existingMessage = {
      id: '00000000-0000-0000-0000-0000000000ee',
      conversationId: CONV_ID,
      content: 'oi',
      outboundIdempotencyKey: 'key-1',
    };

    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set('x-test-auth', '1')
      .set('Idempotency-Key', 'key-1')
      .send({ content: 'oi', type: 'text' });

    expect(res.status).toBe(200);
    expect(res.body.message.id).toBe('00000000-0000-0000-0000-0000000000ee');
    expect(publishOutboundJobMock).not.toHaveBeenCalled();
    expect(lastInsertValues).toBeNull(); // nenhum INSERT
  });

  it('com Idempotency-Key e sem existente → 201, grava a chave + enfileira', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set('x-test-auth', '1')
      .set('Idempotency-Key', 'key-novo')
      .send({ content: 'oi', type: 'text' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message');
    expect(lastInsertValues).toMatchObject({ outboundIdempotencyKey: 'key-novo' });
    expect(publishOutboundJobMock).toHaveBeenCalledOnce();
  });

  it('sem header → 201 legado (chave null, sem lookup de replay)', async () => {
    // Mesmo com uma mensagem existente, sem header não há replay (cria nova).
    existingMessage = { id: 'should-not-be-returned', conversationId: CONV_ID };

    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/messages`)
      .set('x-test-auth', '1')
      .send({ content: 'oi', type: 'text' });

    expect(res.status).toBe(201);
    expect(lastInsertValues).toMatchObject({ outboundIdempotencyKey: null });
    expect(publishOutboundJobMock).toHaveBeenCalledOnce();
  });
});
