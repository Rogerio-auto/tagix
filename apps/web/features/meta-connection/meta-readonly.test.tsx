/**
 * F72-S07 — conexão Meta no DS 3.0: "Conectar com a Meta", "Atualizar" e "Remover" em
 * empresa só leitura (absorve F71-S17); saúde como `StatusPill`. Ambiente `node`.
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
vi.mock('@/features/channels/fb-login', () => ({
  metaLoginConfig: () => ({ configured: true, missing: [] }),
  startMetaConnect: async () => ({ code: 'c' }),
}));
vi.mock('./queries', () => ({
  useMetaUseCases: () => ({
    isLoading: false,
    data: { useCases: [{ id: 'leads', label: 'Leads dos anúncios', permissions: [] }] },
  }),
  useMetaConnections: () => ({
    isLoading: false,
    isError: false,
    data: {
      connections: [
        {
          id: 'm1',
          metaUserName: 'Ana QA',
          status: 'active',
          health: 'ok',
          useCases: [{ id: 'leads', label: 'Leads dos anúncios', missing: [] }],
          assets: { pages: [], adAccounts: [] },
          tokenExpiresAt: null,
          lastCheckedAt: null,
        },
      ],
    },
  }),
  useCreateMetaConnection: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useRefreshMetaConnection: () => ({ isPending: false, mutate: () => undefined, variables: undefined }),
  useRemoveMetaConnection: () => ({ isPending: false, mutate: () => undefined }),
}));

const { MetaConnectionsPanel } = await import('./MetaConnectionsPanel');

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`${label}</button>`);
  expect(at, label).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

const LABELS = ['Conectar com a Meta', 'Atualizar', 'Remover'];

describe('MetaConnectionsPanel (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: ações habilitadas; saúde "Funcionando" ao vivo', () => {
    const html = renderToStaticMarkup(<MetaConnectionsPanel />);
    for (const l of LABELS) expect(buttonTag(html, l)).not.toContain('aria-disabled');
    expect(html).toContain('Funcionando');
    expect(html).toContain('data-live="true"');
  });

  it('só leitura: conectar, atualizar e remover ficam aria-disabled com a explicação', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<MetaConnectionsPanel />);
    for (const l of LABELS) {
      const tag = buttonTag(html, l);
      expect(tag, l).toContain('aria-disabled="true"');
      const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
      expect(html).toContain(`id="${id}" role="tooltip"`);
    }
  });
});
