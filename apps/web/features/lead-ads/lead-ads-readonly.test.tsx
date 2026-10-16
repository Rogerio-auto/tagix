/**
 * F72-S07 — leads dos anúncios no DS 3.0: "Receber leads" e "Parar de receber" em
 * empresa só leitura (absorve F71-S17); estado do lead como `StatusPill`. Ambiente `node`.
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
vi.mock('./queries', () => ({
  useLeadSources: () => ({
    isLoading: false,
    isError: false,
    data: {
      sources: [
        {
          id: 's1',
          pageId: 'pg1',
          pageName: 'Clínica Aurora',
          status: 'active',
          delivery: 'webhook',
          subscribeError: null,
          subscribedAt: null,
          lastReconciledAt: null,
        },
      ],
      available: [{ connectionId: 'm1', pageId: 'pg2', pageName: 'Studio Vértice' }],
      recent: [
        {
          id: 'l1',
          pageId: 'pg1',
          status: 'failed',
          error: 'Formulário sem telefone.',
          attempts: 1,
          conversationId: null,
          dealId: null,
          createdAt: '2026-06-12T12:00:00.000Z',
        },
      ],
    },
  }),
  useSubscribeLeadPage: () => ({ isPending: false, mutate: () => undefined, variables: undefined }),
  useRetrySubscribeLeadPage: () => ({ isPending: false, mutate: () => undefined, variables: undefined }),
  useStopLeadPage: () => ({ isPending: false, mutate: () => undefined, variables: undefined }),
}));

const { LeadSourcesPanel } = await import('./LeadSourcesPanel');

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}</button>`);
  expect(at, label).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

const LABELS = ['Receber leads', 'Parar de receber'];

describe('LeadSourcesPanel (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: ações habilitadas; lead travado em vermelho com o motivo', () => {
    const html = renderToStaticMarkup(<LeadSourcesPanel />);
    for (const l of LABELS) expect(buttonTag(html, l)).not.toContain('aria-disabled');
    expect(html).toContain('Travou');
    expect(html).toContain('Formulário sem telefone.');
  });

  it('só leitura: receber e parar ficam aria-disabled com a explicação', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<LeadSourcesPanel />);
    for (const l of LABELS) {
      const tag = buttonTag(html, l);
      expect(tag, l).toContain('aria-disabled="true"');
      const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
      expect(html).toContain(`id="${id}" role="tooltip"`);
    }
  });
});
