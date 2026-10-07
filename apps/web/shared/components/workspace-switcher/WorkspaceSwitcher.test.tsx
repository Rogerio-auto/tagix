import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as AuthStoreModule from '@/shared/stores/auth.store';
import type { ActiveWorkspace, Membership } from '@/shared/stores/auth.store';
import { WorkspaceList } from './WorkspaceList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

// O vitest do web transforma JSX no modo clássico (sem o runtime automático do Next):
// os componentes referenciam `React` global. Só neste arquivo, sem mexer na config.
(globalThis as { React?: typeof React }).React = React;

// Zustand no servidor devolve sempre o estado INICIAL (getServerSnapshot), então o
// store é trocado por um espelho controlável só para esta renderização estática.
const mockState = vi.hoisted(() => ({
  memberships: [] as unknown[],
  workspace: null as unknown,
}));
vi.mock('@/shared/stores/auth.store', async (importActual) => {
  const actual = await importActual<typeof AuthStoreModule>();
  const useAuthStore = Object.assign(
    (selector: (s: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState },
  );
  return { ...actual, useAuthStore };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

const A: Membership = {
  workspaceId: 'ws-a',
  name: 'Empresa A',
  role: 'OWNER',
  subscriptionStatus: 'active',
};
const B: Membership = {
  workspaceId: 'ws-b',
  name: 'Empresa B',
  role: 'AGENT',
  subscriptionStatus: 'active',
};

function render(memberships: Membership[], collapsed = false): string {
  const first = memberships[0];
  mockState.memberships = memberships;
  mockState.workspace = first
    ? ({
        id: first.workspaceId,
        name: first.name,
        subscriptionStatus: 'active',
        trialEndsAt: null,
      } satisfies ActiveWorkspace)
    : null;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkspaceSwitcher collapsed={collapsed} />
    </QueryClientProvider>,
  );
}

describe('WorkspaceSwitcher', () => {
  it('com 1 empresa: mostra o nome, sem botão nem menu (não é seletor)', () => {
    const html = render([A]);
    expect(html).toContain('Empresa A');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-haspopup');
  });

  it('com 2+ empresas: vira seletor com o nome ativo e nome acessível', () => {
    const html = render([A, B]);
    expect(html).toContain('Empresa A');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('Trocar de empresa');
  });

  it('hidratando (sem nome): placeholder, nunca texto vazio quebrado', () => {
    const html = render([]);
    expect(html).toContain('animate-pulse');
  });
});

describe('WorkspaceList (revisão de design F71)', () => {
  function renderList(): string {
    render([A, B]);
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceList />
      </QueryClientProvider>,
    );
  }

  it('atalho fica na linha do papel (não disputa largura com o nome) e some na ativa', () => {
    const html = renderList();
    // A ativa não precisa de atalho: só o check.
    expect(html).not.toContain('Alt+Shift+1');
    // A outra mostra o atalho DEPOIS do papel, na 2ª linha.
    expect(html).toMatch(/Atendente<\/span><kbd[^>]*>Alt\+Shift\+2<\/kbd>/);
  });

  it('papel AGENT é "Atendente" (o "Agente" do produto é o bot de IA)', () => {
    const html = renderList();
    expect(html).toContain('Atendente');
    expect(html).not.toContain('>Agente<');
  });
});
