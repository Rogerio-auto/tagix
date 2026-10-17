/**
 * F73-S03 — registro de ferramentas do Copiloto: invariantes de construção, descritores
 * filtrados pelas capacidades efetivas (o modelo não vê o que o membro não pode usar) e
 * `emitResult`. Puro.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COPILOT_SETTINGS_DEFAULTS, type CopilotSettingsView } from '@hm/db';
import { CopilotToolDescriptorSchema, type CapabilityMatrix, type Role } from '@hm/shared';
import {
  buildCopilotPrincipal,
  type CopilotPrincipal,
} from '../../../services/copilot/identity/principal';
import { COPILOT_TOOLS, copilotToolDescriptorsFor } from '../index';
import {
  createCopilotToolRegistry,
  defineCopilotTool,
  defineEngineTool,
  emitToolResult,
  isEngineTool,
  listToolDescriptorsFor,
  toolOfferedTo,
  type CopilotToolDefinition,
  type ToolOfferContext,
} from './registry';

const ok = async () => ({ ok: true, decision: 'executed' as const, model_view: 'ok' });

const tools = [
  defineCopilotTool({
    key: 'list_deals',
    capability: 'query',
    area: 'pipeline',
    description: 'Lista negócios do pipeline.',
    args: z
      .object({ stage_id: z.string().uuid().optional(), limit: z.number().int().max(50) })
      .strict(),
    requires: ['pipeline.view'],
    taintsTurn: false,
    handler: ok,
  }),
  defineCopilotTool({
    key: 'list_campaigns',
    capability: 'query',
    area: 'campaigns',
    description: 'Lista campanhas.',
    args: z.object({}).strict(),
    requires: ['campaign.list'],
    taintsTurn: false,
    handler: ok,
  }),
  // Escritas: só pelo motor (`makeProposeTool` usa `defineEngineTool`).
  defineEngineTool({
    key: 'propose_deal_move',
    capability: 'deal.move',
    description: 'Propõe mover negócios.',
    args: z.object({ deal_ids: z.array(z.string().uuid()).min(1).max(200) }).strict(),
    requires: ['pipeline.view'],
    taintsTurn: false,
    handler: ok,
  }),
  defineEngineTool({
    key: 'propose_campaign_cancel',
    capability: 'campaign.cancel',
    description: 'Propõe cancelar uma campanha.',
    args: z.object({ campaign_id: z.string().uuid() }).strict(),
    taintsTurn: false,
    handler: ok,
  }),
];

const offer = (...roles: Role[]): ToolOfferContext => ({ otherActiveRoles: new Set(roles) });

function principalInput(role: Role, matrix: CapabilityMatrix = {}) {
  const settings: CopilotSettingsView = {
    ...COPILOT_SETTINGS_DEFAULTS,
    capabilityMatrix: matrix as Record<string, Record<string, boolean>>,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    persisted: false,
    updatedBy: null,
    updatedAt: null,
  };
  return {
    workspaceId: settings.workspaceId,
    memberId: '00000000-0000-4000-8000-000000000002',
    role,
    memberStatus: 'active',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    settings,
  };
}

function principal(role: Role, matrix: CapabilityMatrix = {}): CopilotPrincipal {
  return buildCopilotPrincipal(principalInput(role, matrix));
}

const keysFor = (p: CopilotPrincipal, o?: ToolOfferContext): string[] =>
  listToolDescriptorsFor(p, tools, o).map((d) => d.key);

describe('listToolDescriptorsFor', () => {
  it('AGENT: vê consulta do pipeline e mover; NÃO vê campanhas nem cancelar campanha', () => {
    expect(keysFor(principal('AGENT'))).toEqual(['list_deals', 'propose_deal_move']);
  });

  it('READONLY: só consultas que o papel permite; nenhuma escrita', () => {
    expect(keysFor(principal('READONLY'))).toEqual(['list_deals', 'list_campaigns']);
  });

  it('OWNER vê tudo; a matriz do dono esconde o que desligou', () => {
    expect(keysFor(principal('OWNER'))).toEqual([
      'list_deals',
      'list_campaigns',
      'propose_deal_move',
      'propose_campaign_cancel',
    ]);
    expect(keysFor(principal('OWNER', { OWNER: { 'campaign.cancel': false } }))).not.toContain(
      'propose_campaign_cancel',
    );
    expect(keysFor(principal('AGENT', { AGENT: { use: false } }))).toEqual([]);
  });

  it('descritor válido pelo contrato, com JSON Schema estrito dos args', () => {
    const [desc] = listToolDescriptorsFor(principal('OWNER'), tools);
    expect(CopilotToolDescriptorSchema.parse(desc)).toEqual(desc);
    expect(desc?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['limit'],
      properties: {
        stage_id: { type: 'string', format: 'uuid' },
        limit: { type: 'integer', maximum: 50 },
      },
    });
  });

  it('o registro de produção compõe sem erro, com chaves únicas e só as 8 consultas de read-crm', () => {
    const keys = COPILOT_TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(
      [
        'aggregate_deals',
        'forecast_revenue',
        'get_contact',
        'get_deal',
        'get_pipeline_overview',
        'list_deals',
        'list_members',
        'search_contacts',
      ].sort(),
    );
    expect(COPILOT_TOOLS.every((t) => t.capability === 'query')).toBe(true);
    expect(keys.some((k) => k.startsWith('propose_'))).toBe(false);
    expect(() => copilotToolDescriptorsFor(principal('OWNER'))).not.toThrow();
  });
});

describe('oferta de escritas (propose_*) a quem pode pedir aprovação (F73-S05)', () => {
  const others = offer('OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY');

  it('o papel não pode, mas existe aprovador possível → oferece (a recusa vira blocked)', () => {
    expect(keysFor(principal('AGENT'), others)).toEqual([
      'list_deals',
      'propose_deal_move',
      'propose_campaign_cancel',
    ]);
    expect(keysFor(principal('READONLY'), others)).toEqual([
      'list_deals',
      'list_campaigns',
      'propose_deal_move',
      'propose_campaign_cancel',
    ]);
  });

  it('sem nenhum aprovador possível → NÃO oferece', () => {
    // Só há atendentes e leitores além de mim: ninguém cancela campanha.
    expect(keysFor(principal('AGENT'), offer('AGENT', 'READONLY'))).not.toContain(
      'propose_campaign_cancel',
    );
    // O único papel que poderia está desligado na matriz.
    expect(
      keysFor(principal('AGENT', { ADMIN: { 'campaign.cancel': false } }), offer('ADMIN')),
    ).not.toContain('propose_campaign_cancel');
    // Sem contexto de oferta: falha fechada (só o que o papel executa).
    expect(keysFor(principal('AGENT'))).not.toContain('propose_campaign_cancel');
  });

  it('capability_disabled para o PRÓPRIO papel esconde, mesmo com aprovadores', () => {
    expect(
      keysFor(principal('AGENT', { AGENT: { 'campaign.cancel': false } }), others),
    ).not.toContain('propose_campaign_cancel');
    expect(keysFor(principal('AGENT', { AGENT: { 'deal.move': false } }), others)).not.toContain(
      'propose_deal_move',
    );
    expect(keysFor(principal('AGENT', { AGENT: { use: false } }), others)).toEqual([]);
  });

  it('assinatura inativa e `queries_only` NÃO escondem (o motor recusa com o motivo)', () => {
    const readOnly = buildCopilotPrincipal({
      ...principalInput('OWNER'),
      subscriptionStatus: 'expired',
    });
    expect(readOnly.subscription.inactive).toBe(true);
    expect(listToolDescriptorsFor(readOnly, tools, others).map((d) => d.key)).toContain(
      'propose_campaign_cancel',
    );
  });

  it('`requires` de leitura não satisfeitas escondem', () => {
    const needsCampaigns = defineEngineTool({
      key: 'propose_campaign_cancel_strict',
      capability: 'campaign.cancel',
      description: 'x',
      args: z.object({ campaign_id: z.string().uuid() }).strict(),
      requires: ['campaign.list'],
      taintsTurn: false,
      handler: ok,
    });
    expect(toolOfferedTo(principal('AGENT'), needsCampaigns, others)).toBe(false);
    expect(toolOfferedTo(principal('READONLY'), needsCampaigns, others)).toBe(true);
  });
});

describe('escrita só pelo motor de propostas (boot)', () => {
  const engine = tools[2]!;

  it('defineCopilotTool recusa capacidade de escrita', () => {
    expect(() =>
      defineCopilotTool({
        key: 'move_direct',
        capability: 'deal.move',
        description: 'x',
        args: z.object({}).strict(),
        taintsTurn: false,
        handler: ok,
      }),
    ).toThrow(/makeProposeTool/);
  });

  it('defineEngineTool recusa consulta e ferramenta que contamina o turno', () => {
    const base = { description: 'x', args: z.object({}).strict(), handler: ok };
    expect(() =>
      defineEngineTool({ ...base, key: 'q', capability: 'query', taintsTurn: false }),
    ).toThrow(/escrita/);
    expect(() =>
      defineEngineTool({ ...base, key: 'w', capability: 'deal.move', taintsTurn: true }),
    ).toThrow(/contato/);
  });

  it('o registro lança com escrita forjada (cópia ou objeto montado com authorization)', () => {
    expect(isEngineTool(engine)).toBe(true);
    expect(() => createCopilotToolRegistry([engine])).not.toThrow();
    const copy: CopilotToolDefinition = { ...engine, key: 'propose_copy' };
    expect(isEngineTool(copy)).toBe(false);
    expect(() => createCopilotToolRegistry([copy])).toThrow(/makeProposeTool/);
    const query = tools[0]!;
    const forged: CopilotToolDefinition = { ...query, key: 'forged', authorization: 'engine' };
    expect(() => createCopilotToolRegistry([forged])).toThrow(/forjada/);
    expect(toolOfferedTo(principal('OWNER'), copy, offer('ADMIN'))).toBe(false);
  });
});

describe('defineCopilotTool / createCopilotToolRegistry', () => {
  const base = {
    capability: 'query' as const,
    description: 'x',
    taintsTurn: false,
    handler: ok,
  };

  it('rótulo vem do catálogo, nunca da ferramenta', () => {
    expect(tools[0]?.label).toBe('Lendo o pipeline…');
    expect(tools[2]?.label).toBe('Preparando a movimentação…');
  });

  it('recusa args sem .strict()', () => {
    expect(() =>
      defineCopilotTool({ ...base, key: 'loose', args: z.object({ a: z.string() }) }),
    ).toThrow(/strict/);
    expect(() =>
      defineCopilotTool({
        ...base,
        key: 'passthru',
        args: z.object({ a: z.string() }).passthrough(),
      }),
    ).toThrow(/strict/);
    expect(() => defineCopilotTool({ ...base, key: 'notobj', args: z.string() })).toThrow();
  });

  it('aceita strict sob refinamento', () => {
    const t = defineCopilotTool({
      ...base,
      key: 'refined',
      args: z
        .object({ a: z.number() })
        .strict()
        .refine((v) => v.a > 0),
    });
    expect(t.key).toBe('refined');
  });

  it('recusa campo de identidade em args (R2)', () => {
    for (const field of ['member_id', 'workspace_id', 'workspaceId', 'actor_member_id']) {
      expect(() =>
        defineCopilotTool({
          ...base,
          key: 'ident',
          args: z.object({ [field]: z.string() }).strict(),
        }),
      ).toThrow(/identidade/);
    }
  });

  it('recusa a lista ampliada de identidade (qualquer grafia)', () => {
    for (const field of [
      'ws',
      'mid',
      'user_id',
      'userId',
      'requested_by',
      'requestedBy',
      'requested_by_member_id',
      'approver_member_id',
      'actor',
      'actor_id',
      'actorUserId',
      'executed_as',
      'executed_as_member_id',
      'executedAsUser',
      'Member-ID',
      'turn_id',
      'nonce',
    ]) {
      expect(() =>
        defineCopilotTool({
          ...base,
          key: 'ident',
          args: z.object({ [field]: z.string() }).strict(),
        }),
      ).toThrow(/identidade/);
    }
  });

  it('recusa campo de identidade aninhado (objeto, array, opcional, união, refinamento)', () => {
    const nested: z.ZodTypeAny[] = [
      z.object({ filter: z.object({ member_id: z.string() }).strict() }).strict(),
      z.object({ items: z.array(z.object({ workspace_id: z.string() })) }).strict(),
      z.object({ opts: z.object({ actor_id: z.string() }).optional() }).strict(),
      z.object({ opts: z.object({ ws: z.string() }).nullable().default(null) }).strict(),
      z
        .object({
          target: z.union([z.object({ id: z.string() }), z.object({ requested_by: z.string() })]),
        })
        .strict(),
      z
        .object({
          target: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('a'), executed_as_member_id: z.string() }),
            z.object({ kind: z.literal('b') }),
          ]),
        })
        .strict(),
      z
        .object({
          deep: z.array(z.array(z.object({ x: z.object({ userId: z.string() }) }))),
        })
        .strict(),
      z
        .object({
          r: z.object({ approver_member_id: z.string() }).refine(() => true),
        })
        .strict(),
      z.object({ t: z.tuple([z.string(), z.object({ mid: z.string() })]) }).strict(),
      z.object({ m: z.record(z.string(), z.object({ actor: z.string() })) }).strict(),
    ];
    for (const args of nested) {
      expect(() => defineCopilotTool({ ...base, key: 'nested', args })).toThrow(
        /identidade proibido em args: 'args\./,
      );
    }
  });

  it('aceita alvos legítimos e objetos aninhados sem identidade', () => {
    const t = defineCopilotTool({
      ...base,
      key: 'ok_nested',
      args: z
        .object({
          owner_id: z.string().uuid().optional(),
          assignee_member_id: z.string().uuid().optional(),
          filters: z
            .object({ stage_ids: z.array(z.string().uuid()), period: z.string() })
            .strict()
            .optional(),
        })
        .strict(),
    });
    expect(t.key).toBe('ok_nested');
  });

  it('recusa objeto aninhado com .passthrough()', () => {
    expect(() =>
      defineCopilotTool({
        ...base,
        key: 'nested_pass',
        args: z.object({ f: z.object({ a: z.string() }).passthrough() }).strict(),
      }),
    ).toThrow(/passthrough/);
  });

  it('recusa key inválida e key repetida', () => {
    expect(() =>
      defineCopilotTool({ ...base, key: 'Bad-Key', args: z.object({}).strict() }),
    ).toThrow();
    const t = defineCopilotTool({ ...base, key: 'dup', args: z.object({}).strict() });
    expect(() => createCopilotToolRegistry([t, t])).toThrow(/repetida/);
  });
});

describe('emitToolResult', () => {
  it('gera result_id e valida o evento público contra o contrato', () => {
    const out = emitToolResult({
      kind: 'kpis',
      source: { label: 'Pipeline', as_of: '2026-10-17T12:00:00.000Z', record_count: 3 },
      truncated: false,
      data: {
        currency: 'BRL',
        items: [
          { key: 'open', label: 'Em aberto', value: 3, format: 'number', delta: null, range: null },
        ],
        why: [],
      },
    });
    expect(out.result_id).toMatch(/^res_[A-Za-z0-9_-]+$/);
    expect(out.public_event).toMatchObject({ type: 'tool_result', v: 1, result_id: out.result_id });
  });

  it('cartão fora do contrato lança (o callback transforma em decision: error)', () => {
    expect(() =>
      emitToolResult({
        kind: 'kpis',
        source: { label: 'x', as_of: 'ontem', record_count: 1 },
        truncated: false,
        data: { currency: null, items: [], why: [] },
      }),
    ).toThrow();
  });
});
