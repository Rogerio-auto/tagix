import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  setSubscriptionInactiveListener,
  setUnauthorizedListener,
} from '@/shared/lib/api-client';
import { makeQueryClient } from '@/shared/lib/query-client';
import {
  __resetSessionExpiryForTest,
  handleSessionExpired,
} from '@/shared/auth/session-expiry';
import { useAuthStore, type ActiveWorkspace, type AuthSnapshot } from '@/shared/stores/auth.store';
import {
  pickAccountBanner,
  isWorkspaceReadOnly,
  trialDaysLeft,
  type PendingInvite,
} from './banner-priority';
import { createSubscriptionInactiveHandler } from './subscription-inactive';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

function ws(over: Partial<ActiveWorkspace> = {}): ActiveWorkspace {
  return { id: 'ws-a', name: 'A', subscriptionStatus: 'active', trialEndsAt: null, ...over };
}
const INVITE: PendingInvite = {
  id: 'i1',
  workspaceId: 'ws-z',
  workspaceName: 'Empresa Z',
  role: 'AGENT',
  inviterName: 'Bia',
  expiresAt: iso(NOW + 5 * DAY),
};

afterEach(() => {
  __resetSessionExpiryForTest();
  setUnauthorizedListener(null);
  setSubscriptionInactiveListener(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAuthStore.setState({ auth: null, workspace: null, memberships: [], status: 'idle' });
});

describe('pickAccountBanner (prioridade, uma por vez)', () => {
  it('1) só leitura vence tudo (trial vencido conta como expired)', () => {
    const expired = ws({ subscriptionStatus: 'expired' });
    expect(pickAccountBanner({ workspace: expired, invites: [INVITE], now: NOW })).toEqual({
      kind: 'read_only',
    });
    const canceled = ws({ subscriptionStatus: 'canceled' });
    expect(pickAccountBanner({ workspace: canceled, invites: [], now: NOW })?.kind).toBe(
      'read_only',
    );
    const trialGone = ws({ subscriptionStatus: 'trial', trialEndsAt: iso(NOW - 1000) });
    expect(pickAccountBanner({ workspace: trialGone, invites: [INVITE], now: NOW })?.kind).toBe(
      'read_only',
    );
  });

  it('2) trial com até 3 dias; acima disso não avisa', () => {
    const t = (days: number) => ws({ subscriptionStatus: 'trial', trialEndsAt: iso(NOW + days * DAY) });
    expect(pickAccountBanner({ workspace: t(3), invites: [INVITE], now: NOW })).toEqual({
      kind: 'trial_ending',
      days: 3,
    });
    expect(pickAccountBanner({ workspace: t(0.5), invites: [], now: NOW })).toEqual({
      kind: 'trial_ending',
      days: 1,
    });
    expect(pickAccountBanner({ workspace: t(4), invites: [], now: NOW })).toBeNull();
    expect(
      pickAccountBanner({ workspace: ws({ subscriptionStatus: 'trial' }), invites: [], now: NOW }),
    ).toBeNull();
  });

  it('3) past_due vence convite', () => {
    const w = ws({ subscriptionStatus: 'past_due' });
    expect(pickAccountBanner({ workspace: w, invites: [INVITE], now: NOW })).toEqual({
      kind: 'past_due',
    });
  });

  it('4) convite pendente só quando nada acima; ignora vencidos e conta os outros', () => {
    const old: PendingInvite = { ...INVITE, id: 'i0', expiresAt: iso(NOW - DAY) };
    const second: PendingInvite = { ...INVITE, id: 'i2' };
    expect(pickAccountBanner({ workspace: ws(), invites: [old], now: NOW })).toBeNull();
    expect(pickAccountBanner({ workspace: ws(), invites: [old, INVITE, second], now: NOW })).toEqual({
      kind: 'invite',
      invite: INVITE,
      others: 1,
    });
    expect(pickAccountBanner({ workspace: null, invites: [INVITE], now: NOW })?.kind).toBe(
      'invite',
    );
  });

  it('empresa saudável, sem convite: nenhuma faixa', () => {
    expect(pickAccountBanner({ workspace: ws(), invites: [], now: NOW })).toBeNull();
  });

  it('helpers', () => {
    expect(isWorkspaceReadOnly(null, NOW)).toBe(false);
    expect(trialDaysLeft(iso(NOW + 2 * DAY), NOW)).toBe(2);
    expect(trialDaysLeft(iso(NOW - 1), NOW)).toBeNull();
  });
});

describe('402 subscription_inactive', () => {
  const AUTH = {
    memberId: 'm1',
    workspaceId: 'ws-a',
    name: 'X',
    role: 'OWNER',
  } as unknown as AuthSnapshot;

  function setup() {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/contacts', search: '', assign } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'subscription_inactive', message: 'x' }), {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    useAuthStore.setState({
      auth: AUTH,
      status: 'authenticated',
      workspace: ws({ subscriptionStatus: 'trial', trialEndsAt: iso(NOW + 20 * DAY) }),
    });
    const toast = vi.fn();
    const handler = createSubscriptionInactiveHandler({
      toast,
      markInactive: () => useAuthStore.getState().markSubscriptionInactive(),
      scopeKey: () => useAuthStore.getState().workspace?.id ?? 'unknown',
    });
    setSubscriptionInactiveListener(handler);
    return { assign, toast };
  }

  it('mostra o toast explicando o só leitura, UMA vez, e NÃO desloga', async () => {
    const { assign, toast } = setup();
    makeQueryClient();

    await expect(api.post('/api/contacts', {})).rejects.toBeInstanceOf(ApiError);
    await expect(api.post('/api/contacts', {})).rejects.toBeInstanceOf(ApiError);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0]).toMatchObject({ variant: 'warn' });
    // sessão intacta
    expect(assign).not.toHaveBeenCalled();
    expect(useAuthStore.getState().auth).toEqual(AUTH);
    expect(useAuthStore.getState().status).toBe('authenticated');
    // a UI passa a mostrar a faixa de só leitura
    expect(isWorkspaceReadOnly(useAuthStore.getState().workspace, NOW)).toBe(true);
    // e a expiração de sessão, se chamada, não foi disparada pelo 402
    handleSessionExpired(null);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('empresa diferente → novo aviso (uma vez por sessão de tela de cada empresa)', async () => {
    const { toast } = setup();
    await expect(api.post('/api/x', {})).rejects.toBeInstanceOf(ApiError);
    useAuthStore.setState({ workspace: ws({ id: 'ws-b', subscriptionStatus: 'expired' }) });
    await expect(api.post('/api/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
