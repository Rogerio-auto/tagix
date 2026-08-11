import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaTemplateError, type MetaMessageTemplate } from '@hm/channels';
import { can, type Permission, type Role } from '@hm/shared';
import type { DbTx } from '@hm/db';

const authState = vi.hoisted(() => ({
  role: 'OWNER' as Role,
  scoped: null as null | ((fn: (tx: DbTx) => Promise<unknown>) => Promise<unknown>),
}));

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      member: { role: authState.role },
      workspace: { id: 'workspace-a' },
    } as never;
    next();
  },
  withRLS: (req: Request, _res: Response, next: NextFunction) => {
    req.scoped = authState.scoped as never;
    next();
  },
  requireRole: (permission: Permission) =>
    (_req: Request, res: Response, next: NextFunction) => {
      if (!can(authState.role, permission)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

const { createMessageTemplatesRouter } = await import('./templates');

function app(client: { listAll: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }) {
  const instance = express();
  instance.use(express.json());
  instance.use(
    createMessageTemplatesRouter({
      client,
      decrypt: () => 'secret-token',
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    }),
  );
  return instance;
}

function fakeSyncTx(): DbTx {
  const channel = {
    id: 'channel-a',
    workspaceId: 'workspace-a',
    provider: 'meta_whatsapp',
    isActive: true,
    wabaId: 'waba-a',
    accessTokenEnc: 'ciphertext-only',
    keyVersion: 1,
  };
  const selectChain = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectChain,
    limit: async () => [channel],
  };
  const insertChain = {
    values: () => insertChain,
    onConflictDoNothing: () => insertChain,
    returning: async () => [{ channelId: 'channel-a' }],
  };
  const updateChain = { set: () => updateChain, where: async () => [] };
  return {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  } as unknown as DbTx;
}

describe('permissões de modelos de mensagem', () => {
  it.each(['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'] as const)(
    '%s pode consultar o catálogo',
    (role) => expect(can(role, 'message_template.view')).toBe(true),
  );

  it('somente OWNER e ADMIN podem sincronizar/criar', () => {
    expect(can('OWNER', 'message_template.manage')).toBe(true);
    expect(can('ADMIN', 'message_template.manage')).toBe(true);
    expect(can('SUPERVISOR', 'message_template.manage')).toBe(false);
    expect(can('AGENT', 'message_template.manage')).toBe(false);
    expect(can('READONLY', 'message_template.manage')).toBe(false);
  });
});

describe('API de modelos de mensagem', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
    authState.scoped = async (fn) => fn(fakeSyncTx());
  });

  it('barra AGENT na leitura e READONLY na mutação', async () => {
    const client = { listAll: vi.fn(), create: vi.fn() };
    authState.role = 'AGENT';
    expect((await request(app(client)).get('/api/channels/channel-a/message-templates')).status).toBe(403);
    authState.role = 'READONLY';
    expect(
      (await request(app(client)).post('/api/channels/channel-a/message-templates/sync')).status,
    ).toBe(403);
  });

  it('valida Zod + contrato Meta antes de qualquer rede', async () => {
    const client = { listAll: vi.fn(), create: vi.fn() };
    const response = await request(app(client))
      .post('/api/channels/channel-a/message-templates')
      .send({
        name: 'Nome Inválido',
        language: 'pt_BR',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Olá' }],
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('MESSAGE_TEMPLATE_VALIDATION');
    expect(response.body.issues[0]).toEqual(
      expect.objectContaining({ path: expect.any(Array), message: expect.any(String) }),
    );
    expect(client.create).not.toHaveBeenCalled();
  });

  it('sanitiza rate limit, devolve Retry-After e nunca expõe o token', async () => {
    const client = {
      listAll: vi.fn().mockRejectedValue(
        new MetaTemplateError('rate_limit', {
          permanence: 'transient',
          retryAfterMs: 4_200,
        }),
      ),
      create: vi.fn(),
    };
    const response = await request(app(client)).post(
      '/api/channels/channel-a/message-templates/sync',
    );
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('5');
    expect(JSON.stringify(response.body)).not.toContain('secret-token');
    expect(JSON.stringify(response.body)).not.toContain('ciphertext-only');
    expect(client.listAll).toHaveBeenCalledWith({ wabaId: 'waba-a', accessToken: 'secret-token' });
  });

  it('não incentiva duplicata quando a Meta aceitou e a persistência falhou', async () => {
    const accepted: MetaMessageTemplate = {
      externalId: 'meta-1',
      name: 'boas_vindas',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'PENDING',
      components: [{ type: 'BODY', text: 'Olá' }],
    };
    const client = { listAll: vi.fn(), create: vi.fn().mockResolvedValue(accepted) };
    let calls = 0;
    authState.scoped = async (fn) => {
      calls += 1;
      if (calls === 1) return fn(fakeSyncTx());
      throw new Error('database unavailable');
    };
    const response = await request(app(client))
      .post('/api/channels/channel-a/message-templates')
      .send({
        name: 'boas_vindas',
        language: 'pt_BR',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Olá' }],
      });
    expect(response.status).toBe(503);
    expect(response.body.providerAccepted).toBe(true);
    expect(response.body.message).toContain('Sincronize antes');
  });
});
