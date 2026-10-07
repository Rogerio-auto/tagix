import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/stores/auth.store';
import {
  canSwitchWorkspace,
  classifySwitchError,
  performWorkspaceSwitch,
} from './switch-workspace';
import { ApiError } from '@/shared/lib/api-client';
import { workspaceShortcutIndex, workspaceShortcutLabel } from './shortcuts';

const ME_B = {
  member: { id: 'm2', workspaceId: 'ws-b', name: 'Ana', role: 'AGENT', status: 'active' },
  workspace: { id: 'ws-b', name: 'Empresa B', subscriptionStatus: 'active', trialEndsAt: null },
  memberships: [
    { workspaceId: 'ws-b', name: 'Empresa B', role: 'AGENT', subscriptionStatus: 'active' },
    { workspaceId: 'ws-a', name: 'Empresa A', role: 'OWNER', subscriptionStatus: 'active' },
  ],
};

function stubFetch(status: number, body: unknown) {
  const impl = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ auth: null, workspace: null, memberships: [], status: 'idle' });
});

describe('performWorkspaceSwitch', () => {
  it('troca: POST, limpa TODO o cache, aplica a empresa nova, reconecta o socket e vai para /', async () => {
    const fetchMock = stubFetch(200, ME_B);
    const queryClient = new QueryClient();
    queryClient.setQueryData(['conversations'], [{ id: 'dado da empresa A' }]);
    queryClient.setQueryData(['contacts', 1], ['outro dado da A']);
    const order: string[] = [];
    const reconnect = vi.fn(() => {
      order.push('reconnect');
      return true;
    });
    const navigate = vi.fn(() => order.push('navigate'));

    const result = await performWorkspaceSwitch({
      workspaceId: 'ws-b',
      queryClient,
      reconnect,
      navigate,
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/me/workspace');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: 'ws-b' });
    // nenhum dado da empresa anterior sobrevive
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(['conversations'])).toBeUndefined();
    // store reflete a empresa nova
    expect(useAuthStore.getState().workspace?.name).toBe('Empresa B');
    expect(useAuthStore.getState().memberships).toHaveLength(2);
    expect(useAuthStore.getState().auth?.workspaceId).toBe('ws-b');
    // socket reconectado e navegação DEPOIS do cache limpo
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reconnect', 'navigate']);
  });

  it('falha do servidor: não limpa o cache, não reconecta, não navega', async () => {
    stubFetch(404, { error: 'workspace_not_found', message: 'x' });
    const queryClient = new QueryClient();
    queryClient.setQueryData(['conversations'], ['a']);
    const reconnect = vi.fn(() => true);
    const navigate = vi.fn();

    const result = await performWorkspaceSwitch({
      workspaceId: 'ws-x',
      queryClient,
      reconnect,
      navigate,
    });

    expect(result).toMatchObject({ ok: false, code: 'not_found' });
    expect(queryClient.getQueryData(['conversations'])).toEqual(['a']);
    expect(reconnect).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('classifica os erros do contrato', () => {
    expect(classifySwitchError(new ApiError(404, 'x', undefined, undefined, 'workspace_not_found'))).toBe(
      'not_found',
    );
    expect(
      classifySwitchError(new ApiError(403, 'x', undefined, undefined, 'impersonation_read_only')),
    ).toBe('read_only_view');
    expect(classifySwitchError(new ApiError(500, 'x'))).toBe('failed');
    expect(classifySwitchError(new TypeError('network'))).toBe('failed');
  });
});

describe('seletor', () => {
  it('só é seletor com 2+ empresas', () => {
    expect(canSwitchWorkspace([])).toBe(false);
    expect(canSwitchWorkspace([{}])).toBe(false);
    expect(canSwitchWorkspace([{}, {}])).toBe(true);
  });
});

describe('atalhos', () => {
  const base = { altKey: true, shiftKey: true, ctrlKey: false, metaKey: false };
  it('Alt+Shift+1..9 mapeia para o índice; o resto é ignorado', () => {
    expect(workspaceShortcutIndex({ ...base, code: 'Digit1' })).toBe(0);
    expect(workspaceShortcutIndex({ ...base, code: 'Digit9' })).toBe(8);
    expect(workspaceShortcutIndex({ ...base, code: 'Digit0' })).toBeNull();
    expect(workspaceShortcutIndex({ ...base, code: 'KeyA' })).toBeNull();
    expect(workspaceShortcutIndex({ ...base, shiftKey: false, code: 'Digit1' })).toBeNull();
    expect(workspaceShortcutIndex({ ...base, ctrlKey: true, code: 'Digit1' })).toBeNull();
  });
  it('rótulos por plataforma', () => {
    expect(workspaceShortcutLabel(0, false)).toBe('Alt+Shift+1');
    expect(workspaceShortcutLabel(1, true)).toBe('⌥⇧2');
    expect(workspaceShortcutLabel(9, false)).toBeNull();
  });
});
