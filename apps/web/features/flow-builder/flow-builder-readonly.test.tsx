/**
 * F72-S07 (sub-lote c) — flow-builder no DS 3.0: botões de escrita em empresa só leitura
 * (absorve F71-S17) na lista, na reordenação dos manuais, no backup, na barra do editor,
 * no painel de execuções e na barra de flows da conversa; a lista como `DataTable` com
 * contagens em mono; e o fuso da janela comercial sem literal. Ambiente `node`: render
 * estático (o comportamento de clique é coberto no e2e `sweep-ds3-c`).
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import { ReactFlowProvider } from '@xyflow/react';

Reflect.set(globalThis, 'React', React);

const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';
const state = { readOnly: false, role: 'OWNER', mobile: false };

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
  useBreakpoint: () => ({
    isMobile: state.mobile,
    isTablet: false,
    isDesktop: !state.mobile,
    isBelowDesktop: state.mobile,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const mutation = { isPending: false, mutate: () => undefined, mutateAsync: async () => undefined };
const flow = (id: string, name: string, status: string, triggerType: string, manualPosition: number | null) => ({
  id,
  workspaceId: 'ws_1',
  name,
  description: null,
  status,
  triggerType,
  triggerConfig: {},
  channelIds: null,
  manualPosition,
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: '2026-07-02T12:00:00.000Z',
});
const FLOWS = [
  flow('fl_1', 'Boas-vindas', 'active', 'new_message', null),
  flow('fl_2', 'Pós-venda', 'draft', 'keyword', null),
  flow('fl_3', 'Cobrança', 'active', 'manual', 0),
  flow('fl_4', 'Reagendar', 'paused', 'manual', 1),
];

vi.mock('./list/queries', () => ({
  flowKeys: { all: ['flows'], lists: () => ['flows', 'list'] },
  useFlows: () => ({ isLoading: false, isError: false, isFetching: false, refetch: () => undefined, data: { flows: FLOWS } }),
  useCreateFlow: () => mutation,
  useFlowLifecycle: () => mutation,
  useDeleteFlow: () => mutation,
  useReorderManualFlows: () => mutation,
}));
vi.mock('./backup/queries', () => ({
  useExportFlows: () => mutation,
  usePreviewImport: () => mutation,
  useImportFlows: () => mutation,
}));
vi.mock('./hooks/useFlowExecutions', () => ({
  useFlowExecutions: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: {
      executions: [
        { id: 'exec_1', status: 'running', currentNodeId: 'n_1', startedAt: '2026-07-02T12:00:00.000Z', completedAt: null },
        { id: 'exec_2', status: 'completed', currentNodeId: null, startedAt: '2026-07-02T11:00:00.000Z', completedAt: null },
      ],
    },
  }),
  useCancelExecution: () => ({ ...mutation, variables: undefined }),
}));
vi.mock('./livechat/queries', () => ({
  useManualFlows: () => ({
    data: [
      { id: 'fl_3', name: 'Cobrança', status: 'active', triggerType: 'manual', manualPosition: 0 },
      { id: 'fl_5', name: 'Pesquisa NPS', status: 'active', triggerType: 'manual', manualPosition: 1 },
    ],
  }),
  useTriggerFlow: () => mutation,
}));

const { FlowsListPage } = await import('./list/FlowsListPage');
const { BackupPage } = await import('./backup/BackupPage');
const { ToolbarTop } = await import('./canvas/ToolbarTop');
const { ExecutionsPanel } = await import('./canvas/ExecutionsPanel');
const { ManualFlowsQuickbar } = await import('./livechat/ManualFlowsQuickbar');
const { NodePalette } = await import('./canvas/NodePalette');
const tz = await import('./nodes/condition/timezone');

/** Tag de abertura do `<button>` cujo conteúdo termina com `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

/** Tag de abertura do `<button>` com este `aria-label`. */
function labelledButton(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `botão aria-label="${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

/** Focável (sem `disabled`), `aria-disabled` e descrito por um texto que existe no DOM. */
function expectGuarded(html: string, tag: string): void {
  expect(tag).toContain('aria-disabled="true"');
  expect(tag).not.toMatch(/\sdisabled=""/);
  const ids = /aria-describedby="([^"]+)"/.exec(tag)?.[1]?.split(' ') ?? [];
  expect(ids.length).toBeGreaterThan(0);
  const described = ids.some((id) => new RegExp(`id="${id}"[^>]*>${READ_ONLY_TOOLTIP}<`).test(html));
  expect(described, `descrição "${READ_ONLY_TOOLTIP}" ligada ao botão`).toBe(true);
}

const toolbarProps = {
  flowName: 'Boas-vindas',
  status: 'draft' as const,
  dirty: false,
  saving: false,
  publishing: false,
  renaming: false,
  canUndo: false,
  canRedo: false,
  canPublish: true,
  onSave: () => undefined,
  onPublish: () => undefined,
  onRename: () => undefined,
  onUndo: () => undefined,
  onRedo: () => undefined,
};

beforeEach(() => {
  state.readOnly = false;
  state.role = 'OWNER';
  state.mobile = false;
});

describe('FlowsListPage (F72-S07)', () => {
  it('desktop: DataTable com contagens em mono e data em mono à direita', () => {
    const html = renderToStaticMarkup(<FlowsListPage />);
    expect(html).toContain('<caption class="sr-only">Flows</caption>');
    // 4 flows · 2 ativos · 2 manuais — cada número em mono, tabular.
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">4</);
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">2<\/span> ativos/);
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">2<\/span> manuais/);
    expect(html).toContain('Palavra-chave');
    expect(html).toMatch(/text-right[^"]*font-price tabular-nums/);
  });

  it('empresa ativa: criar, publicar e pausar sem aria-disabled; Salvar desabilitado sem alteração', () => {
    const html = renderToStaticMarkup(<FlowsListPage />);
    expect(buttonTag(html, 'Criar flow')).not.toContain('aria-disabled="true"');
    expect(labelledButton(html, 'Publicar Pós-venda')).not.toContain('aria-disabled="true"');
    expect(labelledButton(html, 'Pausar Boas-vindas')).not.toContain('aria-disabled="true"');
    expect(labelledButton(html, 'Reordenar Cobrança')).not.toContain('aria-disabled="true"');
  });

  it('só leitura: criar, publicar, pausar, arquivar, excluir e reordenar ficam guardados', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<FlowsListPage />);
    expectGuarded(html, buttonTag(html, 'Criar flow'));
    expectGuarded(html, labelledButton(html, 'Publicar Pós-venda'));
    expectGuarded(html, labelledButton(html, 'Pausar Boas-vindas'));
    expectGuarded(html, labelledButton(html, 'Arquivar Boas-vindas'));
    expectGuarded(html, labelledButton(html, 'Excluir Pós-venda'));
    expectGuarded(html, labelledButton(html, 'Reordenar Cobrança'));
    expectGuarded(html, labelledButton(html, 'Reordenar Reagendar'));
  });

  it('papel só de leitura (READONLY): nenhuma ação de escrita nem reordenação', () => {
    state.role = 'READONLY';
    const html = renderToStaticMarkup(<FlowsListPage />);
    expect(html).toContain('Boas-vindas');
    expect(html).not.toContain('>Criar flow<');
    expect(html).not.toMatch(/aria-label="(Publicar|Pausar|Arquivar|Excluir|Reordenar) /);
  });

  it('celular: cards com link para o editor e ações guardadas no rodapé', () => {
    state.mobile = true;
    state.readOnly = true;
    const html = renderToStaticMarkup(<FlowsListPage />);
    expect(html).not.toContain('<caption');
    expect(html).toContain('aria-label="Abrir flow Boas-vindas"');
    expectGuarded(html, labelledButton(html, 'Pausar Boas-vindas'));
  });
});

describe('BackupPage (F72-S07)', () => {
  it('exportar é leitura (livre); importar fica guardado em só leitura', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<BackupPage />);
    expect(buttonTag(html, 'Exportar e baixar')).not.toContain('aria-disabled="true"');
    expectGuarded(html, buttonTag(html, 'Selecionar arquivo…'));
  });
});

describe('Editor (F72-S07)', () => {
  it('toolbar: Salvar desabilitado sem alteração, Publicar livre', () => {
    const html = renderToStaticMarkup(<ToolbarTop {...toolbarProps} readOnly={false} />);
    expect(buttonTag(html, 'Salvar')).toMatch(/\sdisabled=""/);
    expect(buttonTag(html, 'Publicar')).not.toContain('aria-disabled="true"');
    expect(html).toContain('<h1');
    expect(html).toContain('>Salvo<');
  });

  it('toolbar em só leitura: Salvar e Publicar focáveis, aria-disabled e explicados; nome sem botão de renomear', () => {
    const html = renderToStaticMarkup(<ToolbarTop {...toolbarProps} readOnly />);
    expectGuarded(html, buttonTag(html, 'Salvar'));
    expectGuarded(html, buttonTag(html, 'Publicar'));
    expect(html).not.toContain('title="Clique para renomear"');
  });

  it('palette: itens são botões (teclado); em só leitura dá lugar à explicação', () => {
    expect(renderToStaticMarkup(<ReactFlowProvider><NodePalette /></ReactFlowProvider>)).toContain('aria-label="Adicionar Mensagem"');
    const ro = renderToStaticMarkup(<ReactFlowProvider><NodePalette readOnly /></ReactFlowProvider>);
    expect(ro).not.toContain('aria-label="Adicionar Mensagem"');
    expect(ro).toContain(READ_ONLY_TOOLTIP);
  });

  it('execuções: só as ativas, contagem em mono e cancelar guardado em só leitura', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ExecutionsPanel flowId="fl_1" />);
    expect(html).toMatch(/font-mono text-xs tabular-nums[^"]*">1</);
    expect(html).toContain('Em execução');
    expect(html).not.toContain('exec_2');
    expectGuarded(html, labelledButton(html, 'Cancelar execução exec_1'));
  });
});

describe('ManualFlowsQuickbar (F72-S07)', () => {
  it('empresa ativa: flows clicáveis, sem explicação de só leitura', () => {
    const html = renderToStaticMarkup(<ManualFlowsQuickbar conversationId="conv_1" />);
    expect(buttonTag(html, 'Cobrança')).not.toContain('aria-disabled="true"');
    expect(html).not.toContain(READ_ONLY_TOOLTIP);
    // Sem a linha neon animada (movimento contínuo só em estado vivo, DS 3.0).
    expect(html).not.toContain('hm-flow-neon');
  });

  it('só leitura: cada flow focável, aria-disabled e descrito pela explicação visível', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ManualFlowsQuickbar conversationId="conv_1" />);
    expectGuarded(html, buttonTag(html, 'Cobrança'));
    expectGuarded(html, buttonTag(html, 'Pesquisa NPS'));
  });
});

describe('Fuso da janela comercial (F72-S07, sem literal)', () => {
  it('sem fuso salvo usa o do navegador (ou o do mercado); fuso inválido também cai no padrão', () => {
    const fallback = tz.browserTimeZone(tz.MARKET_DEFAULT_TIMEZONE);
    expect(tz.isValidTimeZone(fallback)).toBe(true);
    expect(tz.effectiveTimeZone(undefined)).toBe(fallback);
    expect(tz.effectiveTimeZone('Nada/Inexistente')).toBe(fallback);
    expect(tz.effectiveTimeZone(tz.MARKET_DEFAULT_TIMEZONE)).toBe(tz.MARKET_DEFAULT_TIMEZONE);
  });

  it('opções: atual e sugeridos primeiro, sem repetir; rótulo com deslocamento', () => {
    const { suggested, all } = tz.timeZoneOptions(tz.MARKET_DEFAULT_TIMEZONE);
    expect(suggested[0]?.value).toBe(tz.MARKET_DEFAULT_TIMEZONE);
    const ids = [...suggested, ...all].map((o) => o.value);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('UTC');
    expect(suggested[0]?.label).toMatch(/\(GMT/);
  });
});
