import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore, type AuthSnapshot } from '@/shared/stores/auth.store';
import {
  __resetSessionExpiryForTest,
  handleSessionExpired,
  onApiErrorMaybeExpire,
  shouldExpireOn,
} from './session-expiry';

const AUTH = {
  memberId: 'm1',
  workspaceId: 'w1',
  name: 'X',
  role: 'OWNER',
} as unknown as AuthSnapshot;

/** QueryClient fake mínimo — só precisamos observar `clear()`. */
function fakeClient(): QueryClient {
  return { clear: vi.fn() } as unknown as QueryClient;
}

function setAuthed(authed: boolean): void {
  useAuthStore.setState({
    auth: authed ? AUTH : null,
    status: authed ? 'authenticated' : 'unauthenticated',
  });
}

/** Stub de `window` (env node, sem DOM): captura o redirect. */
function stubWindow(pathname = '/conversations', search = ''): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { pathname, search, assign } });
  return assign;
}

afterEach(() => {
  __resetSessionExpiryForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ auth: null, status: 'idle' });
});

describe('shouldExpireOn', () => {
  it('401 com sessão ativa → true', () => {
    setAuthed(true);
    expect(shouldExpireOn(new ApiError(401, 'expirou'))).toBe(true);
  });

  it('403 (sem permissão) → false (não desloga)', () => {
    setAuthed(true);
    expect(shouldExpireOn(new ApiError(403, 'sem permissão'))).toBe(false);
  });

  it('401 sem sessão (pré-login / anônimo) → false (sem loop)', () => {
    setAuthed(false);
    expect(shouldExpireOn(new ApiError(401, 'anon'))).toBe(false);
  });

  it('erro não-ApiError → false', () => {
    setAuthed(true);
    expect(shouldExpireOn(new Error('rede'))).toBe(false);
  });
});

describe('handleSessionExpired', () => {
  it('purga auth + caches e redireciona p/ /login?next=<rota segura>', () => {
    setAuthed(true);
    const assign = stubWindow('/conversations', '?x=1');
    const qc = fakeClient();

    handleSessionExpired(qc);

    expect(qc.clear).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().auth).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fconversations%3Fx%3D1');
  });

  it('idempotente: 401 paralelos → um único redirect', () => {
    setAuthed(true);
    const assign = stubWindow();
    const qc = fakeClient();

    handleSessionExpired(qc);
    handleSessionExpired(qc);

    expect(assign).toHaveBeenCalledOnce();
  });
});

describe('onApiErrorMaybeExpire', () => {
  it('401 com sessão → dispara o expiry; 403 → não', () => {
    setAuthed(true);
    const assign = stubWindow('/pipeline');
    const qc = fakeClient();

    onApiErrorMaybeExpire(new ApiError(403, 'nope'), qc);
    expect(assign).not.toHaveBeenCalled();
    expect(qc.clear).not.toHaveBeenCalled();

    onApiErrorMaybeExpire(new ApiError(401, 'expirou'), qc);
    expect(qc.clear).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpipeline');
  });
});
