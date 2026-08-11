import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';
import type { DbTx } from '@hm/db';
import type * as BuilderServiceModule from './service';

type BuilderService = typeof BuilderServiceModule;

const authState = vi.hoisted(() => ({
  role: 'OWNER' as Role,
  workspaceId: 'workspace-a',
  scopedCalls: 0,
  tx: null as null | DbTx,
}));

vi.mock('../../../middlewares/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      member: { id: 'member-a', role: authState.role },
      workspace: { id: authState.workspaceId },
    } as never;
    next();
  },
  withRLS: (req: Request, _res: Response, next: NextFunction) => {
    // Espelha o contrato do middleware real: TODA leitura roda dentro da
    // transação escopada por RLS. Um endpoint que consultasse o banco fora dela
    // não passaria por aqui e o contador denunciaria.
    req.scoped = (async (fn: (tx: DbTx) => Promise<unknown>) => {
      authState.scopedCalls += 1;
      return fn(authState.tx as DbTx);
    }) as never;
    next();
  },
  requireRole:
    (permission: Permission) => (_req: Request, res: Response, next: NextFunction) => {
      if (!can(authState.role, permission)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

const serviceSpies = vi.hoisted(() => ({
  loadBuilderOptions: vi.fn(),
  loadBuilderTemplateContext: vi.fn(),
  estimateCampaignBase: vi.fn(),
}));

vi.mock('./service', async () => {
  const actual = await vi.importActual<BuilderService>('./service');
  return { ...actual, ...serviceSpies };
});

const { createCampaignBuilderRouter, prepareTestSend } = await import('./index');
const { createCampaignsCrudRouter } = await import('../crud');
const { decodeBindings, encodeBindings } = await import('./contracts');

const CAMPAIGN_ID = '00000000-0000-0000-0000-0000000000c1';
const TEMPLATE_ID = '00000000-0000-0000-0000-0000000000d1';
const url = (suffix: string) => `/api/campaigns/${CAMPAIGN_ID}/builder/${suffix}`;

const CATALOG = [{ type: 'BODY', text: 'Olá {{1}}' }];
const BINDINGS = [
  { component: 'body', index: 1, source: { kind: 'contact', field: 'displayName', fallback: 'cliente' } },
];

function context(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      campaign: {
        id: CAMPAIGN_ID,
        workspaceId: authState.workspaceId,
        channelId: 'channel-a',
        status: 'draft',
        type: 'broadcast',
        timezone: 'America/Sao_Paulo',
        sendWindows: { enabled: false },
        rateLimitPerMinute: 30,
        dailyLimit: 1_000,
        startAt: null,
        ...overrides,
      },
      channel: { id: 'channel-a', provider: 'meta_whatsapp', isActive: true },
      template: { id: TEMPLATE_ID, name: 'oferta', language: 'pt_BR', category: 'MARKETING', components: CATALOG },
      contact: null,
    },
  };
}

function estimateBase() {
  return {
    campaign: context().value.campaign,
    steps: [
      {
        position: 0,
        templateName: 'oferta',
        languageCode: 'pt_BR',
        delaySeconds: 0,
        templateComponents: encodeBindings(BINDINGS as never),
        category: 'MARKETING',
        status: 'APPROVED',
        isAvailable: true,
        templateComponentsFromCatalog: CATALOG,
      },
    ],
    totalDelaySeconds: 0,
    requiresMarketingOptIn: true,
    audience: { total: 10, eligible: 10, invalid: 0, duplicate: 0, optedOut: 0, noConsent: 0 },
  };
}

interface TxState {
  /** Linhas devolvidas por tabela em SELECT. */
  readonly rows: Record<string, unknown[]>;
  /** Linhas devolvidas por `.returning()` em INSERT. */
  readonly returning: Record<string, unknown[]>;
  /** Tabelas em que houve INSERT, na ordem — a prova de que nada extra é criado. */
  readonly inserted: string[];
  /** Valores enviados em cada INSERT, por tabela. */
  readonly values: Record<string, unknown[]>;
}

/**
 * Fake de transação que responde POR TABELA, o suficiente para exercitar o
 * caminho real de `prepareTestSend` e `loadCampaignChannel` sem banco.
 */
function fakeTx(state: TxState): DbTx {
  const chainFor = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      offset: () => chain,
      limit: async () => rows,
      then: (...args: Parameters<Promise<unknown[]>['then']>) =>
        Promise.resolve(rows).then(...args),
    };
    return chain;
  };
  return {
    select: () => ({
      from: (table: object) => chainFor(state.rows[getTableName(table as never)] ?? []),
    }),
    insert: (table: object) => {
      const name = getTableName(table as never);
      state.inserted.push(name);
      const chain: Record<string, unknown> = {
        onConflictDoNothing: () => chain,
        returning: async () => state.returning[name] ?? [],
        then: (...args: Parameters<Promise<unknown[]>['then']>) =>
          Promise.resolve([]).then(...args),
      };
      return {
        values: (payload: unknown) => {
          (state.values[name] ??= []).push(payload);
          return chain;
        },
      };
    },
    delete: () => ({ where: async () => [] }),
  } as unknown as DbTx;
}

function txState(overrides: Partial<TxState> = {}): TxState {
  return {
    rows: {},
    returning: {
      conversations: [{ id: 'conversation-1' }],
      messages: [{ id: 'message-1' }],
      campaigns: [{ id: CAMPAIGN_ID, type: 'broadcast' }],
      campaign_steps: [{ id: 'step-1' }],
    },
    inserted: [],
    values: {},
    ...overrides,
  };
}

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(
    createCampaignBuilderRouter({
      decrypt: () => 'token',
      fetchHealth: async () => ({ qualityRating: 'GREEN', tierLimit: 10_000 }) as never,
      publishOutbound: publishSpy,
      now: () => new Date('2026-08-11T12:00:00.000Z'),
      healthTtlMs: 0,
    }),
  );
  return instance;
}

const publishSpy = vi.fn(async () => true);

beforeEach(() => {
  authState.role = 'OWNER';
  authState.workspaceId = 'workspace-a';
  authState.scopedCalls = 0;
  authState.tx = fakeTx(txState());
  vi.clearAllMocks();
  serviceSpies.loadBuilderOptions.mockResolvedValue({
    modes: [],
    channels: [],
    templates: [],
    page: { nextCursor: null, hasMore: false },
  });
  serviceSpies.loadBuilderTemplateContext.mockResolvedValue(context());
  serviceSpies.estimateCampaignBase.mockResolvedValue(estimateBase());
});

describe('permissões do criador guiado', () => {
  it('quem edita campanha usa o criador; AGENT e READONLY não', () => {
    expect(can('OWNER', 'campaign.edit')).toBe(true);
    expect(can('ADMIN', 'campaign.edit')).toBe(true);
    expect(can('SUPERVISOR', 'campaign.edit')).toBe(true);
    expect(can('READONLY', 'campaign.edit')).toBe(false);
    expect(can('AGENT', 'campaign.edit')).toBe(false);
  });

  it.each(['AGENT', 'READONLY'] as const)('%s recebe 403 em todos os endpoints', async (role) => {
    authState.role = role;
    const instance = app();
    expect((await request(instance).get('/api/campaigns/builder/options')).status).toBe(403);
    expect((await request(instance).post(url('preview')).send({})).status).toBe(403);
    expect((await request(instance).post(url('estimate')).send({})).status).toBe(403);
    expect((await request(instance).post(url('preflight')).send({})).status).toBe(403);
    expect((await request(instance).post(url('test')).send({})).status).toBe(403);
    expect(authState.scopedCalls).toBe(0);
  });
});

describe('isolamento por workspace', () => {
  it('as consultas usam o workspace da sessão, nunca um id vindo do cliente', async () => {
    authState.workspaceId = 'workspace-b';
    await request(app())
      .get('/api/campaigns/builder/options')
      .query({ channelId: '00000000-0000-0000-0000-0000000000b1' });
    expect(serviceSpies.loadBuilderOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'workspace-b' }),
      expect.anything(),
    );

    await request(app()).post(url('estimate')).send({});
    expect(serviceSpies.estimateCampaignBase).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-b',
      CAMPAIGN_ID,
    );
  });

  it('tentar informar o workspace no corpo é recusado, não obedecido', async () => {
    const response = await request(app())
      .post(url('estimate'))
      .send({ workspaceId: 'workspace-a' });
    expect(response.status).toBe(400);
    expect(serviceSpies.estimateCampaignBase).not.toHaveBeenCalled();
  });

  it('toda leitura passa pela transação com RLS', async () => {
    const instance = app();
    await request(instance).get('/api/campaigns/builder/options');
    await request(instance).post(url('preview')).send({ templateId: TEMPLATE_ID, bindings: BINDINGS });
    await request(instance).post(url('estimate')).send({});
    await request(instance).post(url('preflight')).send({});
    expect(authState.scopedCalls).toBeGreaterThanOrEqual(4);
  });

  it('campanha de outro workspace some (404), sem confirmar existência', async () => {
    serviceSpies.estimateCampaignBase.mockResolvedValue(null);
    const response = await request(app()).post(url('estimate')).send({});
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CAMPAIGN_NOT_FOUND');
  });
});

describe('contratos de entrada', () => {
  it('campo desconhecido é recusado antes de qualquer consulta', async () => {
    const response = await request(app()).post(url('estimate')).send({ rate: 999 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CAMPAIGN_BUILDER_INVALID_PAYLOAD');
    expect(authState.scopedCalls).toBe(0);
  });

  it('estimativa aceita ajustes ainda não salvos e responde com duração', async () => {
    const response = await request(app())
      .post(url('estimate'))
      .send({ ratePerMinute: 1, dailyLimit: 5 });
    expect(response.status).toBe(200);
    expect(response.body.capacity.ratePerMinute).toBe(1);
    expect(response.body.capacity.effectiveDailyLimit).toBe(5);
    expect(response.body.duration.approximateDays).toBe(2);
  });

  it('preflight devolve pendências com etapa e código estáveis', async () => {
    const base = estimateBase();
    serviceSpies.estimateCampaignBase.mockResolvedValue({
      ...base,
      steps: [{ ...base.steps[0]!, status: 'PENDING' }],
    });
    const response = await request(app()).post(url('preflight')).send({});
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({ code: 'CAMPAIGN_TEMPLATE_NOT_APPROVED', stage: 'message', blocking: true }),
    );
  });

  it('prévia devolve as pendências de variável sem enviar nada', async () => {
    const response = await request(app())
      .post(url('preview'))
      .send({ templateId: TEMPLATE_ID, bindings: [] });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CAMPAIGN_TEMPLATE_VARIABLES_INVALID');
    expect(response.body.issues[0].code).toBe('VARIABLE_MISSING');
  });

  it('canal indisponível explica o que fazer em vez de 404 genérico', async () => {
    serviceSpies.loadBuilderTemplateContext.mockResolvedValue({
      ok: false,
      reason: 'channel_not_available',
    });
    const response = await request(app())
      .post(url('preview'))
      .send({ templateId: TEMPLATE_ID, bindings: BINDINGS });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CAMPAIGN_CHANNEL_NOT_AVAILABLE');
    expect(response.body.message).toContain('Reconecte');
  });
});

describe('envio de teste', () => {
  const payload = { templateId: TEMPLATE_ID, to: '+5511999998888', bindings: BINDINGS };

  it('sem Idempotency-Key não sai do lugar', async () => {
    const response = await request(app()).post(url('test')).send(payload);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CAMPAIGN_TEST_IDEMPOTENCY_REQUIRED');
    expect(publishSpy).not.toHaveBeenCalled();
    expect(authState.scopedCalls).toBe(0);
  });

  it('enfileira no pipeline outbound real com o payload do modelo', async () => {
    const response = await request(app())
      .post(url('test'))
      .set('Idempotency-Key', 'test-1')
      .send(payload);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ queued: true, replayed: false });
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [workspaceId, job] = publishSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(workspaceId).toBe('workspace-a');
    expect(job).toMatchObject({
      kind: 'template',
      templateName: 'oferta',
      languageCode: 'pt_BR',
      chatId: '5511999998888',
      channelId: 'channel-a',
    });
  });

  it('não cria destinatário nem entrega de campanha — métricas ficam limpas', async () => {
    const state = txState();
    authState.tx = fakeTx(state);
    await request(app()).post(url('test')).set('Idempotency-Key', 'test-1').send(payload);
    expect(state.inserted).toEqual(['conversations', 'messages', 'audit_logs']);
  });

  it('clique duplo devolve a mesma mensagem e não publica de novo', async () => {
    authState.tx = fakeTx(txState({ rows: { messages: [{ id: 'message-1' }] } }));
    const response = await request(app())
      .post(url('test'))
      .set('Idempotency-Key', 'test-1')
      .send(payload);
    expect(response.status).toBe(202);
    expect(response.body.replayed).toBe(true);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('campanha que já saiu do rascunho não aceita mais teste', async () => {
    serviceSpies.loadBuilderTemplateContext.mockResolvedValue(context({ status: 'running' }));
    const response = await request(app())
      .post(url('test'))
      .set('Idempotency-Key', 'test-1')
      .send(payload);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CAMPAIGN_TEST_REQUIRES_DRAFT');
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('variável de botão é recusada com explicação enquanto o runtime não a preserva', async () => {
    const response = await request(app())
      .post(url('test'))
      .set('Idempotency-Key', 'test-1')
      .send({
        ...payload,
        bindings: [{ component: 'button', index: 1, source: { kind: 'fixed', value: 'x' } }],
      });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CAMPAIGN_TEST_BUTTON_VARIABLE_UNSUPPORTED');
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe('prepareTestSend', () => {
  it('reaproveita a conversa existente do número em vez de duplicar', async () => {
    const state = txState({ returning: { conversations: [], messages: [] } });
    const prepared = await prepareTestSend(fakeTx(state), {
      workspaceId: 'workspace-a',
      memberId: 'member-a',
      campaignId: CAMPAIGN_ID,
      to: '+5511999998888',
      idempotencyKey: 'k',
      context: context().value as never,
      preview: {
        header: null,
        body: 'Olá cliente',
        footer: null,
        buttons: [],
        variables: [],
        outbound: { kind: 'template', templateName: 'oferta', languageCode: 'pt_BR', components: [] },
      },
    });
    // `onConflictDoNothing` não devolveu linha (conversa já existia) e o SELECT
    // de fallback também veio vazio → prepara nada em vez de inventar id.
    expect(prepared).toBeNull();
  });
});

function crudApp() {
  const instance = express();
  instance.use(express.json());
  instance.use(createCampaignsCrudRouter());
  return instance;
}

const CHANNEL_ID = '00000000-0000-0000-0000-0000000000b1';

describe('modos do produto no CRUD de campanhas', () => {
  it('Envio único grava broadcast e Sequência grava drip', async () => {
    const single = txState();
    authState.tx = fakeTx(single);
    const created = await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'Oferta', mode: 'single' });
    expect(created.status).toBe(201);
    expect(single.values['campaigns']?.[0]).toMatchObject({ type: 'broadcast' });

    const sequence = txState();
    authState.tx = fakeTx(sequence);
    await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'Nutrição', mode: 'sequence' });
    expect(sequence.values['campaigns']?.[0]).toMatchObject({ type: 'drip' });
  });

  it('triggered é recusado com explicação, não com erro genérico', async () => {
    const response = await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'Evento', type: 'triggered' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('CAMPAIGN_TRIGGERED_NOT_AVAILABLE');
    expect(response.body.message).toContain('Envio único');
  });

  it('mode e type incoerentes não passam', async () => {
    const response = await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'X', mode: 'sequence', type: 'broadcast' });
    expect(response.status).toBe(400);
  });

  it('sem formato escolhido, não cria', async () => {
    const response = await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'X' });
    expect(response.status).toBe(400);
  });

  it('o formato técnico continua aceito para não quebrar quem já integra', async () => {
    const state = txState();
    authState.tx = fakeTx(state);
    const response = await request(crudApp())
      .post('/api/campaigns')
      .send({ channelId: CHANNEL_ID, name: 'X', type: 'drip' });
    expect(response.status).toBe(201);
    expect(state.values['campaigns']?.[0]).toMatchObject({ type: 'drip' });
  });

  it('PUT /steps persiste os bindings no contrato que o runtime lê', async () => {
    const state = txState({ rows: { campaigns: [{ id: CAMPAIGN_ID }] } });
    authState.tx = fakeTx(state);
    const response = await request(crudApp())
      .put(`/api/campaigns/${CAMPAIGN_ID}/steps`)
      .send({ steps: [{ position: 0, templateName: 'oferta', bindings: BINDINGS }] });
    expect(response.status).toBe(200);
    const stored = state.values['campaign_steps']?.[0] as { templateComponents: unknown }[];
    expect(decodeBindings(stored[0]?.templateComponents)).toEqual(BINDINGS);
  });

  it('binding inválido não chega ao banco', async () => {
    const state = txState({ rows: { campaigns: [{ id: CAMPAIGN_ID }] } });
    authState.tx = fakeTx(state);
    const response = await request(crudApp())
      .put(`/api/campaigns/${CAMPAIGN_ID}/steps`)
      .send({
        steps: [
          {
            position: 0,
            templateName: 'oferta',
            bindings: [{ component: 'body', index: 1, source: { kind: 'contact', field: 'displayName' } }],
          },
        ],
      });
    expect(response.status).toBe(400);
    expect(state.values['campaign_steps']).toBeUndefined();
  });
});
