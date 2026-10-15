/**
 * F72-S07 — conversões no DS 3.0: botões de escrita em empresa só leitura (absorve
 * F71-S17): "Marcar conversão" e, nos tipos, "Adicionar" e "Remover". Ambiente `node`.
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
  useConversionTypes: () => ({
    isLoading: false,
    isError: false,
    refetch: () => undefined,
    data: {
      conversionTypes: [
        {
          id: 't1',
          key: 'venda',
          label: 'Venda fechada',
          color: '',
          icon: null,
          valueRequired: true,
          valueLabel: null,
          currency: 'BRL',
          isDefault: true,
          position: 0,
          isActive: true,
        },
      ],
    },
  }),
  useCreateConversionType: () => ({ isPending: false, mutate: () => undefined }),
  useDeleteConversionType: () => ({ isPending: false, mutate: () => undefined }),
  useRegisterConversion: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

const { ConversionTypesSettings } = await import('./ConversionTypesSettings');
const { MarkConversionButton } = await import('./MarkConversionButton');

function tagAround(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

const MARKERS = ['>Adicionar<', 'aria-label="Remover tipo Venda fechada"'];

describe('Conversões — só leitura (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: escrever é livre', () => {
    const html = renderToStaticMarkup(<ConversionTypesSettings />);
    for (const m of MARKERS) expect(tagAround(html, m)).not.toContain('aria-disabled');
    const btn = renderToStaticMarkup(<MarkConversionButton contactId="c1" />);
    expect(tagAround(btn, 'Marcar conversão')).not.toContain('aria-disabled');
  });

  it('só leitura: adicionar, remover e marcar ficam aria-disabled com a explicação ligada', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ConversionTypesSettings />);
    for (const m of MARKERS) {
      const tag = tagAround(html, m);
      expect(tag).toContain('aria-disabled="true"');
      const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
      expect(html).toContain(`id="${id}" role="tooltip"`);
    }
    const btn = renderToStaticMarkup(<MarkConversionButton contactId="c1" />);
    const tag = tagAround(btn, 'Marcar conversão');
    expect(tag).toContain('aria-disabled="true"');
    expect(btn).toContain('Modo só leitura: escolha um plano para voltar a editar.');
  });
});
