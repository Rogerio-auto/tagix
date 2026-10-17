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
  emitToolResult,
  listToolDescriptorsFor,
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
  defineCopilotTool({
    key: 'propose_deal_move',
    capability: 'deal.move',
    description: 'Propõe mover negócios.',
    args: z.object({ deal_ids: z.array(z.string().uuid()).min(1).max(200) }).strict(),
    taintsTurn: false,
    handler: ok,
  }),
  defineCopilotTool({
    key: 'propose_campaign_cancel',
    capability: 'campaign.cancel',
    description: 'Propõe cancelar uma campanha.',
    args: z.object({ campaign_id: z.string().uuid() }).strict(),
    taintsTurn: false,
    handler: ok,
  }),
];

function principal(role: Role, matrix: CapabilityMatrix = {}): CopilotPrincipal {
  const settings: CopilotSettingsView = {
    ...COPILOT_SETTINGS_DEFAULTS,
    capabilityMatrix: matrix as Record<string, Record<string, boolean>>,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    persisted: false,
    updatedBy: null,
    updatedAt: null,
  };
  return buildCopilotPrincipal({
    workspaceId: settings.workspaceId,
    memberId: '00000000-0000-4000-8000-000000000002',
    role,
    memberStatus: 'active',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    settings,
  });
}

const keysFor = (p: CopilotPrincipal): string[] =>
  listToolDescriptorsFor(p, tools).map((d) => d.key);

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

  it('o registro de produção começa vazio e compõe sem erro', () => {
    expect(COPILOT_TOOLS).toEqual([]);
    expect(copilotToolDescriptorsFor(principal('OWNER'))).toEqual([]);
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
