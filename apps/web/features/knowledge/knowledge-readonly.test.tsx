/**
 * F72-S07 — base de conhecimento no DS 3.0: "Novo documento" em empresa só leitura
 * (absorve F71-S17), lista em `DataTable` e status vivo só no "Processando". Ambiente `node`.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';

Reflect.set(globalThis, 'React', React);

const state = { readOnly: false };

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: <T,>(sel: (s: { auth: { role: string } }) => T): T => sel({ auth: { role: 'OWNER' } }),
}));
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, isBelowDesktop: false }),
}));

const doc = (id: string, title: string, status: 'active' | 'draft') => ({
  id,
  workspaceId: 'ws',
  title,
  source: 'upload',
  sourceUrl: null,
  category: 'Suporte',
  tags: [],
  language: 'pt',
  priority: 5,
  status,
  visibleToAgents: true,
  version: 1,
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: null,
});

vi.mock('./queries', () => ({
  useKbDocuments: () => ({
    isLoading: false,
    isError: false,
    refetch: () => undefined,
    data: {
      documents: [doc('d1', 'Política de reembolso', 'active'), doc('d2', 'Tabela de preços', 'draft')],
      total: 2,
      limit: 50,
      offset: 0,
    },
  }),
  useKbDocument: () => ({ isLoading: false, data: undefined }),
  useCreateKbDocument: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useUpdateKbDocument: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useReprocessKbDocument: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useArchiveKbDocument: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

const { KnowledgeBasePage } = await import('./KnowledgeBasePage');

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, label).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

describe('KnowledgeBasePage (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: "Novo documento" habilitado', () => {
    const html = renderToStaticMarkup(<KnowledgeBasePage />);
    expect(buttonTag(html, 'Novo documento')).not.toContain('aria-disabled');
  });

  it('só leitura: "Novo documento" aria-disabled, focável e com a explicação', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<KnowledgeBasePage />);
    const tag = buttonTag(html, 'Novo documento');
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).not.toMatch(/\sdisabled=""/);
    const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(html).toContain(`id="${id}" role="tooltip"`);
  });

  it('DataTable com prioridade em mono e só o "Processando" pulsando', () => {
    const html = renderToStaticMarkup(<KnowledgeBasePage />);
    expect(html).toContain('<caption class="sr-only">Documentos da base de conhecimento</caption>');
    expect(html.match(/data-live="true"/g)).toHaveLength(1);
    expect(html).toContain('Processando');
    expect(html).toContain('Indexado');
  });
});
