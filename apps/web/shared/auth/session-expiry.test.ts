import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, api, setUnauthorizedListener } from '@/shared/lib/api-client';
import { makeQueryClient } from '@/shared/lib/query-client';
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

/** `fetch` que sempre responde o status dado (com corpo JSON). */
function stubFetch(status: number, body: Record<string, unknown> = { message: 'x' }) {
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
  __resetSessionExpiryForTest();
  setUnauthorizedListener(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ auth: null, status: 'idle' });
});

describe('shouldExpireOn', () => {
  it('401 de sessão numa tela protegida → true', () => {
    expect(shouldExpireOn(new ApiError(401, 'expirou'), '/conversations')).toBe(true);
  });

  it('F70-S28: 401 SEM auth no store (app aberto com cookie morto) → true', () => {
    // Era o bug: o guard antigo exigia `auth != null`, e quem abre o app com o
    // cookie morto nunca chega a ter auth — o handler nunca disparava.
    setAuthed(false);
    expect(
      shouldExpireOn(new ApiError(401, 'x', undefined, undefined, 'session_invalid'), '/hoje'),
    ).toBe(true);
  });

  it('403 (sem permissão) → false (não desloga)', () => {
    expect(shouldExpireOn(new ApiError(403, 'sem permissão'), '/conversations')).toBe(false);
  });

  it('401 numa tela pública (/login) → false — é o que impede o laço', () => {
    expect(shouldExpireOn(new ApiError(401, 'anon'), '/login')).toBe(false);
    expect(shouldExpireOn(new ApiError(401, 'anon'), '/signup')).toBe(false);
  });

  it('401 de NEGÓCIO (senha atual errada) → false — errar a senha não desloga', () => {
    const err = new ApiError(
      401,
      'Senha atual incorreta.',
      undefined,
      undefined,
      'invalid_current_password',
    );
    expect(shouldExpireOn(err, '/settings')).toBe(false);
  });

  it('erro não-ApiError → false', () => {
    expect(shouldExpireOn(new Error('rede'), '/conversations')).toBe(false);
  });

  it('fora do navegador (sem pathname) → false', () => {
    expect(shouldExpireOn(new ApiError(401, 'x'), null)).toBe(false);
  });
});

describe('handleSessionExpired', () => {
  it('purga auth + caches e redireciona p/ /login?next=<rota>&motivo=sessao-expirada', () => {
    setAuthed(true);
    const assign = stubWindow('/conversations', '?x=1');
    const qc = fakeClient();

    handleSessionExpired(qc);

    expect(qc.clear).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().auth).toBeNull();
    expect(assign).toHaveBeenCalledWith(
      '/login?next=%2Fconversations%3Fx%3D1&motivo=sessao-expirada',
    );
  });

  it('idempotente: 401 paralelos → um único redirect', () => {
    const assign = stubWindow();
    const qc = fakeClient();

    handleSessionExpired(qc);
    handleSessionExpired(qc);

    expect(assign).toHaveBeenCalledOnce();
  });

  it('já numa tela pública → não redireciona (sem laço)', () => {
    const assign = stubWindow('/login', '?next=%2Fhoje');
    handleSessionExpired(fakeClient());
    expect(assign).not.toHaveBeenCalled();
  });

  it('sem QueryClient (disparo pelo socket) também redireciona', () => {
    const assign = stubWindow('/hoje');
    handleSessionExpired(null);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fhoje&motivo=sessao-expirada');
  });
});

describe('onApiErrorMaybeExpire', () => {
  it('401 → dispara o expiry; 403 → não', () => {
    const assign = stubWindow('/pipeline');
    const qc = fakeClient();

    onApiErrorMaybeExpire(new ApiError(403, 'nope'), qc);
    expect(assign).not.toHaveBeenCalled();
    expect(qc.clear).not.toHaveBeenCalled();

    onApiErrorMaybeExpire(new ApiError(401, 'expirou'), qc);
    expect(qc.clear).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpipeline&motivo=sessao-expirada');
  });
});

describe('F70-S28 — ponta a ponta no cliente: 401 de QUALQUER chamada leva ao login UMA vez', () => {
  it('hidratação de /api/me com cookie morto (fora do React Query) → login', async () => {
    const assign = stubWindow('/hoje');
    stubFetch(401, { message: 'Não autenticado.', error: 'session_invalid' });
    makeQueryClient();

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fhoje&motivo=sessao-expirada');
  });

  it('rajada de 401 simultâneos (tela com várias queries) → um único redirect', async () => {
    const assign = stubWindow('/conversations');
    stubFetch(401, { message: 'Não autenticado.', error: 'session_invalid' });
    makeQueryClient();

    const calls = ['/api/a', '/api/b', '/api/c', '/api/d'].map((p) => api.get(p).catch(() => null));
    await Promise.all(calls);

    expect(assign).toHaveBeenCalledOnce();
  });

  it('401 na tela de login (credencial errada) → nenhum redirect, erro chega ao formulário', async () => {
    const assign = stubWindow('/login');
    stubFetch(401, { message: 'Email ou senha incorretos.' });
    makeQueryClient();

    await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      status: 401,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('503 (provider de auth fora) → nenhum redirect', async () => {
    const assign = stubWindow('/hoje');
    stubFetch(503, { message: 'Tente de novo.', error: 'auth_unavailable' });
    makeQueryClient();

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('error');
    expect(assign).not.toHaveBeenCalled();
  });

  it('o ApiError carrega o código estável do backend', async () => {
    stubWindow('/settings');
    stubFetch(401, { message: 'Senha atual incorreta.', error: 'invalid_current_password' });
    await expect(api.patch('/api/members/me', {})).rejects.toMatchObject({
      status: 401,
      code: 'invalid_current_password',
    });
  });
});
