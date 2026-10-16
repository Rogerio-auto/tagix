/**
 * F72-S07 — contatos no DS 3.0: "Novo contato" em empresa só leitura (absorve F71-S17)
 * e a lista como `DataTable` (número/data em mono). Ambiente `node`: render estático.
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
vi.mock('./queries', () => ({
  useContacts: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: {
      contacts: [
        {
          id: 'c1',
          displayName: 'Ana Souza',
          phone: '+55 11 90000-0001',
          email: null,
          avatarUrl: null,
          source: 'whatsapp',
          marketingOptIn: true,
          createdAt: '2026-06-12T12:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    },
  }),
  useTags: () => ({ data: { tags: [] } }),
  useContact: () => ({ isLoading: false, isError: false, data: undefined }),
  useCreateContact: () => ({ isPending: false, mutateAsync: async () => undefined }),
  useUpdateContact: () => ({ isPending: false, mutateAsync: async () => undefined, mutate: () => undefined }),
  useAssignTag: () => ({ isPending: false, mutate: () => undefined }),
  useRemoveTag: () => ({ isPending: false, mutate: () => undefined }),
}));

const { ContactsPage } = await import('./ContactsPage');

/** Tag de abertura do `<button>` cujo conteúdo contém `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

describe('ContactsPage (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: "Novo contato" sem aria-disabled', () => {
    const html = renderToStaticMarkup(<ContactsPage />);
    expect(buttonTag(html, 'Novo contato')).not.toContain('aria-disabled');
  });

  it('só leitura: "Novo contato" continua focável, aria-disabled e descrito pela explicação', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ContactsPage />);
    const tag = buttonTag(html, 'Novo contato');
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).not.toMatch(/\sdisabled=""/);
    const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(html).toContain(`id="${id}" role="tooltip"`);
    expect(html).toContain('Modo só leitura: escolha um plano para voltar a editar.');
  });

  it('desktop: lista em DataTable com data em mono à direita', () => {
    const html = renderToStaticMarkup(<ContactsPage />);
    expect(html).toContain('<caption class="sr-only">Contatos</caption>');
    expect(html).toContain('Ana Souza');
    expect(html).toMatch(/font-mono[^"]*tabular-nums[^"]*">\+55 11 90000-0001/);
    expect(html).toMatch(/text-right[^"]*font-price tabular-nums/);
  });
});
