/**
 * Testes da API de envio de mensagens (F1-S24 / F30-S04).
 *
 * Cobre:
 *  - POST /api/conversations/:id/messages — sem sessão → 401
 *  - F30-S04: envio humano com IA on → pausa automática + evento emitido
 *  - F30-S04: envio humano com IA paused → só atualiza aiLastHumanAt (idempotente)
 *  - F30-S04: envio humano com IA off → sem efeito colateral no ai_mode
 *  - Conversa não encontrada → 404
 *  - Payload inválido → 400
 *
 * Estratégia: mocks de `@hm/db`, `@hm/shared/mq` e dos módulos de middlewares/
 * publisher — sem Docker/Postgres/RabbitMQ necessário. O relay AMQP é best-effort
 * (allSettled); mockamos sendToQueue para verificar a emissão do evento de handoff.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks de infra ───────────────────────────────────────────────────────────

// Guard de visibilidade por-conversa (S07.1) — controlável por teste; default visível.
const { assertVisibleMock } = vi.hoisted(() => ({ assertVisibleMock: vi.fn() }));

const sendToQueueMock = vi.fn();
const connectMqMock = vi.fn().mockResolvedValue({
  channel: { sendToQueue: sendToQueueMock },
  connection: {},
});

vi.mock('@hm/shared/mq', () => ({
  connectMq: (...args: unknown[]) => connectMqMock(...args),
  makeEnvelope: (_type: string, _ws: string, payload: unknown) => payload,
}));

// Mock do publisher outbound (não queremos conectar ao broker real).
vi.mock('../../mq/outbound-publisher', () => ({
  publishOutboundJob: vi.fn().mockResolvedValue(true),
}));

// ─── Estado mutável das conversas em memória ──────────────────────────────────

const CONV_ID = '00000000-0000-0000-0000-000000000c01';
const MEMBER_OWNER = '00000000-0000-0000-0000-000000000001';

/** Conversa mutável para os testes — ai_mode varia por cenário. */
let convRow: { channelId: string; remoteId: string; aiMode: string } | null = {
  channelId: '00000000-0000-0000-0000-000000000a01',
  remoteId: '+5511999990001',
  aiMode: 'on',
};

/** Captura as atualizações feitas na conversa pela lógica de handoff. */
let lastConvUpdate: Record<string, unknown> | null = null;

vi.mock('@hm/db', () => ({
  schema: {
    conversations: {
      id: 'id',
      channelId: 'channelId',
      remoteId: 'remoteId',
      aiMode: 'aiMode',
      aiPausedReason: 'aiPausedReason',
      aiPausedAt: 'aiPausedAt',
      aiPausedBy: 'aiPausedBy',
      aiLastHumanAt: 'aiLastHumanAt',
      updatedAt: 'updatedAt',
    },
    messages: {
      workspaceId: 'workspaceId',
      conversationId: 'conversationId',
    },
    auditLogs: {
      workspaceId: 'workspaceId',
    },
  },
  assertConversationVisible: assertVisibleMock,
}));

// ─── Mock de auth ─────────────────────────────────────────────────────────────

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
    (req as { scoped?: unknown }).scoped = async (
      fn: (tx: MockTx) => Promise<unknown>,
    ) => fn(makeTx());
    next();
  },
  requireRole: (_perm: string) => (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

// ─── Tx fake ──────────────────────────────────────────────────────────────────

type MockTx = ReturnType<typeof makeTx>;

/** Retorna uma mensagem com id estável para o teste de 201. */
const FAKE_MESSAGE = {
  id: '00000000-0000-0000-0000-000000000f01',
  conversationId: CONV_ID,
  content: 'oi',
  direction: 'outbound',
};

function makeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (_n: number) => (convRow ? [convRow] : []),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (_data: unknown) => ({
        returning: () => Promise.resolve([FAKE_MESSAGE]),
      }),
    }),
    update: (_table: unknown) => ({
      set: (data: unknown) => ({
        where: (_cond: unknown) => {
          // Captura o set para asserção nos testes.
          lastConvUpdate = data as Record<string, unknown>;
          return Promise.resolve();
        },
      }),
    }),
  };
}

// ─── App de teste ─────────────────────────────────────────────────────────────

const { createMessagesRouter } = await import('./messages');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createMessagesRouter());
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authedPost(path: string) {
  return request(makeApp()).post(path).set('x-test-auth', '1');
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  lastConvUpdate = null;
  assertVisibleMock.mockResolvedValue(true);
  convRow = {
    channelId: '00000000-0000-0000-0000-000000000a01',
    remoteId: '+5511999990001',
    aiMode: 'on',
  };
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('POST /api/conversations/:id/messages', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONV_ID}/messages`)
      .send({ content: 'oi', type: 'text' });
    expect(res.status).toBe(401);
  });

  it('conversa não encontrada → 404', async () => {
    convRow = null;
    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'oi',
      type: 'text',
    });
    expect(res.status).toBe(404);
  });

  it('S07.1: conversa invisível ao remetente → 404 (IDOR de escrita fechado)', async () => {
    // A conversa existe no tenant, mas está fora da visibilidade do membro.
    assertVisibleMock.mockResolvedValue(false);
    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'mensagem indevida',
      type: 'text',
    });
    expect(res.status).toBe(404);
    // Nada foi enfileirado nem persistido (guard precede a escrita).
    expect(lastConvUpdate).toBeNull();
  });

  it('body sem content de texto → 400', async () => {
    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      type: 'text',
    });
    expect(res.status).toBe(400);
  });

  it('mídia sem mediaUrl → 400', async () => {
    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      type: 'image',
      mediaMime: 'image/png',
    });
    expect(res.status).toBe(400);
  });

  it('envio válido de texto → 201 com { message }', async () => {
    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'oi',
      type: 'text',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message');
    expect(res.body.message.id).toBe(FAKE_MESSAGE.id);
  });

  // ── F30-S04: auto-pausa de IA ──────────────────────────────────────────────

  it('F30-S04: IA on — humano responde → ai_mode vira paused + human_takeover + evento emitido', async () => {
    convRow = { ...convRow!, aiMode: 'on' };

    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'deixa comigo',
      type: 'text',
    });
    expect(res.status).toBe(201);

    // O update na conversa deve ter setado ai_mode=paused e human_takeover.
    expect(lastConvUpdate).not.toBeNull();
    expect(lastConvUpdate).toMatchObject({
      aiMode: 'paused',
      aiPausedReason: 'human_takeover',
      aiPausedBy: MEMBER_OWNER,
    });
    expect(lastConvUpdate!['aiPausedAt']).toBeInstanceOf(Date);
    expect(lastConvUpdate!['aiLastHumanAt']).toBeInstanceOf(Date);

    // Evento de socket deve ter sido publicado para o relay.
    expect(sendToQueueMock).toHaveBeenCalledOnce();
    const [queueName, buf] = sendToQueueMock.mock.calls[0] as [string, Buffer, unknown];
    expect(queueName).toBe('hm.q.socket.relay');
    const envelope = JSON.parse((buf as Buffer).toString()) as {
      event: string;
      data: { aiMode: string; reason: string };
    };
    expect(envelope).toMatchObject({
      event: 'conversation:ai_mode_changed',
      data: { aiMode: 'paused', reason: 'human_takeover' },
    });
  });

  it('F30-S04: IA paused — humano responde → só atualiza aiLastHumanAt (idempotente, sem evento)', async () => {
    convRow = { ...convRow!, aiMode: 'paused' };

    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'continuando aqui',
      type: 'text',
    });
    expect(res.status).toBe(201);

    // Não deve ter setado ai_mode nem aiPausedReason.
    expect(lastConvUpdate).not.toBeNull();
    expect(lastConvUpdate).not.toHaveProperty('aiMode');
    expect(lastConvUpdate).not.toHaveProperty('aiPausedReason');
    expect(lastConvUpdate!['aiLastHumanAt']).toBeInstanceOf(Date);

    // Nenhum evento de socket deve ser emitido (só pausa nova dispara).
    expect(sendToQueueMock).not.toHaveBeenCalled();
  });

  it('F30-S04: IA off — humano responde → só atualiza aiLastHumanAt (sem mudança de ai_mode)', async () => {
    convRow = { ...convRow!, aiMode: 'off' };

    const res = await authedPost(`/api/conversations/${CONV_ID}/messages`).send({
      content: 'tudo certo?',
      type: 'text',
    });
    expect(res.status).toBe(201);

    expect(lastConvUpdate).not.toBeNull();
    expect(lastConvUpdate).not.toHaveProperty('aiMode');
    expect(lastConvUpdate!['aiLastHumanAt']).toBeInstanceOf(Date);

    // Nenhum evento de socket (IA já estava off).
    expect(sendToQueueMock).not.toHaveBeenCalled();
  });
});
