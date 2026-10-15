/**
 * F72-S07 — catálogo de produtos no DS 3.0: "Novo produto" e "Arquivar" em empresa só
 * leitura (absorve F71-S17) e o preço em mono à direita do `DataTable`. Ambiente `node`.
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
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, isBelowDesktop: false }),
}));
vi.mock('./queries', () => ({
  useProducts: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: () => undefined,
    data: {
      products: [
        {
          id: 'p1',
          workspaceId: 'ws',
          name: 'Consultoria',
          sku: 'CONS-01',
          description: null,
          priceCents: 50_000,
          currency: 'BRL',
          active: true,
          createdAt: '2026-06-12T12:00:00.000Z',
          updatedAt: null,
          deletedAt: null,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    },
  }),
  useDeleteProduct: () => ({ isPending: false, mutate: () => undefined }),
  useCreateProduct: () => ({ isPending: false, mutate: () => undefined }),
  useUpdateProduct: () => ({ isPending: false, mutate: () => undefined }),
}));

const { ProductsCatalog } = await import('./ProductsCatalog');

function tagAround(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

describe('ProductsCatalog (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: criar e arquivar habilitados', () => {
    const html = renderToStaticMarkup(<ProductsCatalog />);
    expect(tagAround(html, '>Novo produto<')).not.toContain('aria-disabled');
    expect(tagAround(html, 'aria-label="Arquivar Consultoria"')).not.toContain('aria-disabled');
  });

  it('só leitura: criar e arquivar ficam aria-disabled, focáveis e com a explicação', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ProductsCatalog />);
    for (const marker of ['>Novo produto<', 'aria-label="Arquivar Consultoria"']) {
      const tag = tagAround(html, marker);
      expect(tag).toContain('aria-disabled="true"');
      expect(tag).not.toMatch(/\sdisabled=""/);
      const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
      expect(html).toContain(`id="${id}" role="tooltip"`);
    }
  });

  it('preço na coluna numérica (mono, tabular, à direita)', () => {
    const html = renderToStaticMarkup(<ProductsCatalog />);
    expect(html).toMatch(/<td class="[^"]*text-right[^"]*font-price tabular-nums[^"]*">[^<]*500/);
  });
});
