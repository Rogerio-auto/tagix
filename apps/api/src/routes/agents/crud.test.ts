/**
 * Testes de F56-S30 — o wizard de criação de agente interpola as respostas no
 * `promptTemplate` do template (AUDITORIA_TECNICA §3.3 / AG-03).
 *
 * Duas camadas:
 *  1. Unit puro de `renderPromptTemplate` — determinístico, sem HTTP/DB.
 *  2. Integração via router (`createAgentsCrudRouter`) com `@hm/db` e auth
 *     mockados (mesmo padrão de `routes.test.ts`, mock independente): criar a
 *     partir de template renderiza o system prompt e valida os obrigatórios.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_ID = '00000000-0000-0000-0000-0000000000a1';
const TEMPLATE_ID = '00000000-0000-0000-0000-0000000000b1';

const PROMPT_TEMPLATE = [
  'Você é um vendedor da {{business_name}}, especialista em {{product_summary}}.',
  'Tom de voz: {{tone}}.',
  'Horário: {{business_hours}}.',
  'Contexto do runtime: {{contact_name}}.',
].join('\n');

/** Estado in-memory manipulável por teste. */
interface TxState {
  template: { id: string; promptTemplate: string; defaultModel: string; defaultModelParams: unknown; defaultTools: string[] } | null;
  questions: Array<{ key: string; label: string; required: boolean }>;
  lastAgentInsert: Record<string, unknown> | null;
}

let state: TxState;

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

vi.mock('@hm/db', () => {
  const table = (name: string) => new Proxy({ __t: name }, { get: (t, p) => (p === '__t' ? name : `${name}.${String(p)}`) });
  return {
    schema: {
      agents: table('agents'),
      agentTemplates: table('agentTemplates'),
      agentTemplateQuestions: table('agentTemplateQuestions'),
      agentTools: table('agentTools'),
      agentPromptVersions: table('agentPromptVersions'),
      tools: table('tools'),
      departments: table('departments'),
    },
    agentDepartmentsRepo: {
      setAgentDepartments: vi.fn(async () => {}),
      listDepartmentsForAgent: vi.fn(async () => []),
    },
    closeDb: vi.fn(),
  };
});

// ─── Mock de auth ─────────────────────────────────────────────────────────────

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as { auth?: unknown }).auth = {
      workspace: { id: WORKSPACE_ID },
      member: { id: MEMBER_ID },
    };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx());
    next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

// ─── Tx fake (subset do Drizzle usado pelo crud.ts) ───────────────────────────

function tableName(t: unknown): string {
  return typeof t === 'object' && t !== null && '__t' in t ? String((t as { __t: unknown }).__t) : '';
}

function makeTx() {
  const agentRow = () => ({
    id: AGENT_ID,
    workspaceId: WORKSPACE_ID,
    name: (state.lastAgentInsert?.['name'] as string) ?? 'Agente',
    systemPrompt: (state.lastAgentInsert?.['systemPrompt'] as string) ?? '',
    status: 'active',
  });

  return {
    select: (_cols: unknown) => ({
      from: (tbl: unknown) => {
        const t = tableName(tbl);
        return {
          where: (): unknown => {
            if (t === 'agentTemplates') return { limit: () => (state.template ? [state.template] : []) };
            if (t === 'agentTemplateQuestions') return state.questions;
            if (t === 'tools') return [];
            if (t === 'departments') return [];
            // F56-S31: nextVersionNumber() faz coalesce(max(version)) → array direto.
            if (t === 'agentPromptVersions') return [{ max: 0 }];
            return { limit: () => [agentRow()] };
          },
          orderBy: () => [agentRow()],
          limit: () => [agentRow()],
        };
      },
    }),
    insert: (tbl: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (tableName(tbl) === 'agents') state.lastAgentInsert = vals;
        return {
          returning: () => (tableName(tbl) === 'agents' ? [agentRow()] : []),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
    update: (_tbl: unknown) => ({
      set: (_d: unknown) => ({ where: () => ({ returning: () => [agentRow()] }) }),
    }),
    delete: (_tbl: unknown) => ({ where: () => Promise.resolve() }),
  };
}

// ─── Imports do módulo sob teste (após os mocks) ──────────────────────────────

const { createAgentsCrudRouter, renderPromptTemplate } = await import('./crud');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createAgentsCrudRouter());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    template: {
      id: TEMPLATE_ID,
      promptTemplate: PROMPT_TEMPLATE,
      defaultModel: 'openai/gpt-4o-mini',
      defaultModelParams: {},
      defaultTools: [],
    },
    questions: [
      { key: 'business_name', label: 'Nome do negócio', required: true },
      { key: 'product_summary', label: 'O que você vende', required: true },
      { key: 'tone', label: 'Tom de voz', required: true },
      { key: 'business_hours', label: 'Horário de atendimento', required: false },
    ],
    lastAgentInsert: null,
  };
});

// ─── Unit: renderPromptTemplate ───────────────────────────────────────────────

describe('renderPromptTemplate', () => {
  const keys = new Set(['business_name', 'tone', 'items']);

  it('interpola placeholders conhecidos com as respostas', () => {
    const out = renderPromptTemplate('Olá {{business_name}}, tom {{tone}}.', {
      business_name: 'Acme',
      tone: 'amigável',
    }, keys);
    expect(out).toBe('Olá Acme, tom amigável.');
  });

  it('remove placeholder conhecido sem resposta (opcional não respondida)', () => {
    const out = renderPromptTemplate('Horário: {{tone}}.', {}, keys);
    expect(out).toBe('Horário: .');
  });

  it('preserva placeholders desconhecidos (variáveis de runtime)', () => {
    const out = renderPromptTemplate('Oi {{contact_name}}, {{business_name}}.', {
      business_name: 'Acme',
    }, keys);
    expect(out).toBe('Oi {{contact_name}}, Acme.');
  });

  it('junta multiselect por vírgula e formata boolean/número', () => {
    const k = new Set(['items', 'flag', 'n']);
    const out = renderPromptTemplate('{{items}} | {{flag}} | {{n}}', {
      items: ['a', 'b', 'c'],
      flag: true,
      n: 42,
    }, k);
    expect(out).toBe('a, b, c | sim | 42');
  });

  it('não reinterpreta $ / $1 das respostas do usuário', () => {
    const out = renderPromptTemplate('Preço {{tone}}', { tone: 'R$ 10 ($1 cada)' }, keys);
    expect(out).toBe('Preço R$ 10 ($1 cada)');
  });
});

// ─── Integração via router ────────────────────────────────────────────────────

describe('POST /api/agents — interpolação do wizard (F56-S30)', () => {
  it('cria a partir de template renderizando o system prompt com as answers', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .send({
        name: 'Vendas WhatsApp',
        templateId: TEMPLATE_ID,
        answers: {
          business_name: 'Acme',
          product_summary: 'planos de internet',
          tone: 'consultivo',
          business_hours: 'Seg a Sex, 9h às 18h',
        },
      });

    expect(res.status).toBe(201);
    const prompt = state.lastAgentInsert?.['systemPrompt'] as string;
    expect(prompt).toContain('vendedor da Acme, especialista em planos de internet');
    expect(prompt).toContain('Tom de voz: consultivo');
    expect(prompt).toContain('Horário: Seg a Sex, 9h às 18h');
    // placeholder de runtime preservado (não é uma question):
    expect(prompt).toContain('{{contact_name}}');
    // nenhum placeholder de question deve sobrar:
    expect(prompt).not.toMatch(/\{\{\s*(business_name|product_summary|tone|business_hours)\s*\}\}/);
  });

  it('rejeita quando falta resposta a uma pergunta obrigatória → 400 com mensagem clara', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .send({
        name: 'Incompleto',
        templateId: TEMPLATE_ID,
        answers: { business_name: 'Acme' }, // faltam product_summary e tone (required)
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('O que você vende');
    expect(res.body.message).toContain('Tom de voz');
    expect(state.lastAgentInsert).toBeNull();
  });

  it('interpola vazio nos opcionais não respondidos, mas cria o agente', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .send({
        name: 'Sem horário',
        templateId: TEMPLATE_ID,
        answers: {
          business_name: 'Acme',
          product_summary: 'consultoria',
          tone: 'profissional',
          // business_hours omitido (opcional)
        },
      });

    expect(res.status).toBe(201);
    const prompt = state.lastAgentInsert?.['systemPrompt'] as string;
    expect(prompt).toContain('Horário: .');
  });

  it('prompt explícito ignora o template (não valida perguntas, não interpola)', async () => {
    const res = await request(makeApp())
      .post('/api/agents')
      .send({
        name: 'Custom',
        templateId: TEMPLATE_ID,
        systemPrompt: 'Prompt totalmente customizado.',
        // sem answers — required não é validado porque há prompt explícito
      });

    expect(res.status).toBe(201);
    expect(state.lastAgentInsert?.['systemPrompt']).toBe('Prompt totalmente customizado.');
  });
});
