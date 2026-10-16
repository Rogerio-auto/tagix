/**
 * F72-S07 (sub-lote b) — agentes no DS 3.0: botões de escrita em empresa só leitura
 * (absorve F71-S17), lista em `DataTable`, versões do prompt com guarda e confirmação,
 * e métricas com números no idioma da interface (custo só para quem pode agir sobre ele).
 * Ambiente `node`: render estático.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';

Reflect.set(globalThis, 'React', React);

const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';
const state = { readOnly: false, role: 'OWNER' };

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: <T,>(sel: (s: { auth: { role: string } }) => T): T => sel({ auth: { role: state.role } }),
}));
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, isBelowDesktop: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
}));

const mutation = { isPending: false, mutate: () => undefined, mutateAsync: async () => undefined };
const ok = <T,>(data: T) => ({ isLoading: false, isError: false, isFetching: false, refetch: () => undefined, data });

const agent = (id: string, name: string, status: string, model: string | null) => ({
  id,
  workspaceId: 'ws_1',
  templateId: null,
  name,
  description: 'Atende leads do WhatsApp',
  systemPrompt: 'Você é um vendedor.',
  model,
  modelParams: null,
  visionModel: null,
  transcriptionModel: null,
  status,
  aggregationEnabled: true,
  aggregationWindowSec: 8,
  maxBatchMessages: 10,
  replyIfIdleSec: null,
  allowHandoff: true,
  ignoreGroupMessages: true,
  enabledChannelIds: null,
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-12T12:00:00.000Z',
});

vi.mock('./queries', () => ({
  queryKeys: { detail: (id: string) => ['agents', id] },
  useAgents: () =>
    ok({
      agents: [
        agent('ag_1', 'Vendas WhatsApp', 'active', 'anthropic/claude-sonnet-4.5'),
        agent('ag_2', 'Recepção', 'inactive', null),
      ],
    }),
  useSetAgentStatus: () => mutation,
  useCreateAgent: () => mutation,
  useAgentTemplates: () => ok([]),
  useAgentModels: () => ok([]),
  useWorkspaceDepartments: () => ok({ departments: [] }),
}));

const version = (id: string, n: number, status: string) => ({
  id,
  agentId: 'ag_1',
  version: n,
  status,
  systemPrompt: `prompt v${n}`,
  model: 'anthropic/claude-sonnet-4.5',
  modelParams: {},
  label: null,
  note: null,
  authorMemberId: null,
  rolledBackFrom: null,
  createdAt: '2026-06-10T12:00:00.000Z',
  publishedAt: status === 'live' ? '2026-06-11T12:00:00.000Z' : null,
});

vi.mock('./detail/versions/queries', () => ({
  useAgentVersions: () =>
    ok({ versions: [version('pv_3', 3, 'draft'), version('pv_2', 2, 'live'), version('pv_1', 1, 'archived')] }),
  useAgentVersionDiff: () => ({ isLoading: false, isError: false, data: undefined }),
  useCreateDraft: () => mutation,
  usePublishVersion: () => ({ ...mutation, variables: undefined }),
  useRollbackVersion: () => ({ ...mutation, variables: undefined }),
  useDiscardDraft: () => mutation,
}));

vi.mock('./detail/queries', () => ({
  useAgentMetrics: () =>
    ok([
      {
        period: 'day',
        periodStart: '2026-06-12T00:00:00.000Z',
        totalTokens: 182400,
        totalCostUsd: 1.8214,
        totalConversations: 41,
        totalMessages: 388,
        errorCount: 2,
        handoffCount: 5,
        avgLatencyMs: 1420.4,
      },
    ]),
}));

const { AgentsList } = await import('./list/AgentsList');
const { VersionsPanel } = await import('./detail/versions/VersionsPanel');
const { MetricsTab } = await import('./detail/MetricsTab');

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function labelledButton(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `botão aria-label="${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function expectGuarded(html: string, tag: string): void {
  expect(tag).toContain('aria-disabled="true"');
  expect(tag).not.toMatch(/\sdisabled=""/); // continua focável
  const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`id="${id}" role="tooltip"`);
}

describe('AgentsList (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
    state.role = 'OWNER';
  });

  it('empresa ativa: criar e desativar sem aria-disabled', () => {
    const html = renderToStaticMarkup(<AgentsList />);
    expect(buttonTag(html, 'Criar agente')).not.toContain('aria-disabled');
    expect(labelledButton(html, 'Desativar Vendas WhatsApp')).not.toContain('aria-disabled');
  });

  it('só leitura: criar, ativar e desativar ficam focáveis, aria-disabled e explicados', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<AgentsList />);
    expectGuarded(html, buttonTag(html, 'Criar agente'));
    expectGuarded(html, labelledButton(html, 'Desativar Vendas WhatsApp'));
    expectGuarded(html, labelledButton(html, 'Ativar Recepção'));
    expect(html).toContain(READ_ONLY_TOOLTIP);
  });

  it('desktop: DataTable com modelo em mono e data em mono à direita', () => {
    const html = renderToStaticMarkup(<AgentsList />);
    expect(html).toContain('<caption class="sr-only">Agentes</caption>');
    expect(html).toMatch(/font-mono[^"]*">anthropic\/claude-sonnet-4\.5</);
    expect(html).toMatch(/text-right[^"]*font-price tabular-nums/);
  });

  it('papel sem edição (AGENT): lista sem criar nem ativar', () => {
    state.role = 'AGENT';
    const html = renderToStaticMarkup(<AgentsList />);
    expect(html).toContain('Vendas WhatsApp');
    expect(html).not.toContain('>Criar agente<');
    expect(html).not.toMatch(/aria-label="(Ativar|Desativar) /);
  });
});

describe('VersionsPanel (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('só leitura: novo rascunho, publicar, descartar e restaurar ficam aria-disabled', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<VersionsPanel agentId="ag_1" canEdit />);
    expectGuarded(html, buttonTag(html, 'Novo rascunho'));
    expectGuarded(html, labelledButton(html, 'Publicar v3'));
    expectGuarded(html, labelledButton(html, 'Descartar rascunho v3'));
    expectGuarded(html, labelledButton(html, 'Restaurar v1'));
    // Comparar só lê: nunca é guardado.
    expect(labelledButton(html, 'Comparar v1')).not.toContain('aria-disabled');
  });

  it('sem permissão de edição: só comparar', () => {
    const html = renderToStaticMarkup(<VersionsPanel agentId="ag_1" />);
    expect(html).not.toContain('>Novo rascunho<');
    expect(html).not.toContain('aria-label="Publicar v3"');
    expect(html).toContain('aria-label="Comparar v3"');
  });
});

describe('MetricsTab (F72-S07)', () => {
  it('números no idioma da interface, em mono; custo escondido de quem não pode agir', () => {
    const html = renderToStaticMarkup(<MetricsTab agentId="ag_1" />);
    expect(html).toContain('<caption class="sr-only">Métricas por período</caption>');
    expect(html).toMatch(/182[.,\s]?400/);
    expect(html).toMatch(/1[.,\s]?420 ms/);
    expect(html).not.toContain('Custo');
  });

  it('com agent.view_costs: custo em dólar (moeda do dado)', () => {
    const html = renderToStaticMarkup(<MetricsTab agentId="ag_1" canViewCosts />);
    expect(html).toContain('Custo total');
    expect(html).toMatch(/(US\$|\$)\s?1[.,]8214/);
  });
});
