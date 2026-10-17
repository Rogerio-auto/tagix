/**
 * F73-S03 — `authorizeCapability` na ordem do ADR-003 §3 (passos 4–6) e o estado do
 * orçamento (P8, teto duro de consulta). Puro.
 */
import { describe, expect, it } from 'vitest';
import { COPILOT_SETTINGS_DEFAULTS, type CopilotSettingsView } from '@hm/db';
import { ROLES, type CapabilityMatrix, type Role } from '@hm/shared';
import { authorizeCapability } from './authorize';
import { COPILOT_QUERY_HARD_CEILING_RATIO, budgetResetsOn, computeBudgetState } from './budget';
import {
  buildCopilotPrincipal,
  sanitizeCapabilityMatrix,
  type CopilotPrincipal,
} from './principal';

const WS = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';

function settings(over: Partial<CopilotSettingsView> = {}): CopilotSettingsView {
  return {
    ...COPILOT_SETTINGS_DEFAULTS,
    capabilityMatrix: {},
    workspaceId: WS,
    persisted: true,
    updatedBy: null,
    updatedAt: null,
    ...over,
  };
}

function principal(
  role: Role,
  over: {
    status?: string;
    subscription?: string;
    matrix?: CapabilityMatrix;
    enabled?: boolean;
  } = {},
): CopilotPrincipal {
  return buildCopilotPrincipal({
    workspaceId: WS,
    memberId: MEMBER,
    role,
    memberStatus: over.status ?? 'active',
    subscriptionStatus: over.subscription ?? 'active',
    trialEndsAt: null,
    settings: settings({
      enabled: over.enabled ?? true,
      capabilityMatrix: (over.matrix ?? {}) as Record<string, Record<string, boolean>>,
    }),
  });
}

describe('authorizeCapability', () => {
  it('consulta passa para os 5 papéis com orçamento ok', () => {
    for (const role of ROLES) {
      expect(authorizeCapability(principal(role), 'query', { budget: 'ok' })).toEqual({
        allowed: true,
      });
    }
  });

  it('papel sem a permissão → role (READONLY não move negócio; AGENT não cancela campanha)', () => {
    expect(authorizeCapability(principal('READONLY'), 'deal.move', { budget: 'ok' })).toEqual({
      allowed: false,
      reason: 'role',
    });
    expect(authorizeCapability(principal('AGENT'), 'campaign.cancel', { budget: 'ok' })).toEqual({
      allowed: false,
      reason: 'role',
    });
    expect(authorizeCapability(principal('SUPERVISOR'), 'deal.move', { budget: 'ok' })).toEqual({
      allowed: true,
    });
  });

  it('permissão muda com o volume real (message.send: 1 alvo vs 2+)', () => {
    const agent = principal('AGENT');
    expect(
      authorizeCapability(agent, 'message.send', { budget: 'ok', targetCount: 1 }).allowed,
    ).toBe(true);
    expect(authorizeCapability(agent, 'message.send', { budget: 'ok', targetCount: 2 })).toEqual({
      allowed: false,
      reason: 'role',
    });
  });

  it('permissões de entidade da ferramenta também contam', () => {
    expect(
      authorizeCapability(principal('AGENT'), 'query', {
        budget: 'ok',
        permissions: ['campaign.list'],
      }),
    ).toEqual({ allowed: false, reason: 'role' });
  });

  it('matriz desligada → capability_disabled; `use: false` também', () => {
    const p = principal('SUPERVISOR', { matrix: { SUPERVISOR: { 'deal.move': false } } });
    expect(authorizeCapability(p, 'deal.move', { budget: 'ok' })).toEqual({
      allowed: false,
      reason: 'capability_disabled',
    });
    const off = principal('AGENT', { matrix: { AGENT: { use: false } } });
    expect(authorizeCapability(off, 'query', { budget: 'ok' })).toEqual({
      allowed: false,
      reason: 'capability_disabled',
    });
  });

  it('matriz `true` nunca concede o que o papel não tem', () => {
    const p = principal('READONLY', { matrix: { READONLY: { 'deal.move': true } } });
    expect(authorizeCapability(p, 'deal.move', { budget: 'ok' })).toMatchObject({ reason: 'role' });
  });

  it('só leitura: escrita → subscription_inactive; consulta passa', () => {
    const p = principal('OWNER', { subscription: 'expired' });
    expect(authorizeCapability(p, 'deal.move', { budget: 'ok' })).toEqual({
      allowed: false,
      reason: 'subscription_inactive',
    });
    expect(authorizeCapability(p, 'query', { budget: 'ok' })).toEqual({ allowed: true });
  });

  it('isWrite só endurece: consulta marcada como escrita vira escrita; escrita nunca vira consulta', () => {
    const p = principal('OWNER', { subscription: 'canceled' });
    expect(authorizeCapability(p, 'query', { budget: 'ok', isWrite: true })).toMatchObject({
      reason: 'subscription_inactive',
    });
    expect(authorizeCapability(p, 'deal.move', { budget: 'ok', isWrite: false })).toMatchObject({
      reason: 'subscription_inactive',
    });
  });

  it('orçamento: queries_only barra escrita e deixa consulta; paused barra tudo', () => {
    const p = principal('OWNER');
    expect(authorizeCapability(p, 'deal.move', { budget: 'queries_only' })).toMatchObject({
      reason: 'budget',
    });
    expect(authorizeCapability(p, 'query', { budget: 'queries_only' })).toEqual({ allowed: true });
    expect(authorizeCapability(p, 'query', { budget: 'paused' })).toMatchObject({
      reason: 'budget',
    });
    expect(authorizeCapability(p, 'deal.move', { budget: 'alert' })).toEqual({ allowed: true });
  });

  it('ordem: membro inativo vence tudo; depois desligado; depois papel; depois assinatura; depois orçamento', () => {
    const inactive = principal('OWNER', {
      status: 'blocked',
      enabled: false,
      subscription: 'expired',
    });
    expect(authorizeCapability(inactive, 'deal.move', { budget: 'paused' })).toMatchObject({
      reason: 'role',
    });
    const disabled = principal('READONLY', { enabled: false, subscription: 'expired' });
    expect(authorizeCapability(disabled, 'deal.move', { budget: 'paused' })).toMatchObject({
      reason: 'copilot_disabled',
    });
    const roleFirst = principal('READONLY', { subscription: 'expired' });
    expect(authorizeCapability(roleFirst, 'deal.move', { budget: 'paused' })).toMatchObject({
      reason: 'role',
    });
    const subFirst = principal('OWNER', { subscription: 'expired' });
    expect(authorizeCapability(subFirst, 'deal.move', { budget: 'paused' })).toMatchObject({
      reason: 'subscription_inactive',
    });
  });

  it('trial vencido conta como só leitura (mesma régua do guard)', () => {
    const p = buildCopilotPrincipal({
      workspaceId: WS,
      memberId: MEMBER,
      role: 'OWNER',
      memberStatus: 'active',
      subscriptionStatus: 'trial',
      trialEndsAt: new Date(Date.now() - 1000),
      settings: settings(),
    });
    expect(p.subscription).toEqual({ effectiveStatus: 'expired', inactive: true });
    expect(authorizeCapability(p, 'contact.tag', { budget: 'ok' })).toMatchObject({
      reason: 'subscription_inactive',
    });
  });
});

describe('sanitizeCapabilityMatrix', () => {
  it('descarta papel, chave e valor desconhecidos (sem conceder nada)', () => {
    expect(
      sanitizeCapabilityMatrix({
        AGENT: { 'deal.move': false, hack: true, 'contact.tag': 'no' },
        ROOT: { query: true },
        ADMIN: null,
      }),
    ).toEqual({ AGENT: { 'deal.move': false } });
    expect(sanitizeCapabilityMatrix(null)).toEqual({});
    expect(sanitizeCapabilityMatrix([1, 2])).toEqual({});
  });
});

describe('computeBudgetState', () => {
  const base = { capUsd: 30, alertPct: 80, mode: 'queries_only' as const };

  it('ok → alert → queries_only → paused no teto duro de consulta', () => {
    expect(computeBudgetState({ ...base, spentUsd: 0 })).toBe('ok');
    expect(computeBudgetState({ ...base, spentUsd: 23.99 })).toBe('ok');
    expect(computeBudgetState({ ...base, spentUsd: 24 })).toBe('alert');
    expect(computeBudgetState({ ...base, spentUsd: 30 })).toBe('queries_only');
    expect(
      computeBudgetState({ ...base, spentUsd: 30 * COPILOT_QUERY_HARD_CEILING_RATIO - 0.01 }),
    ).toBe('queries_only');
    expect(computeBudgetState({ ...base, spentUsd: 30 * COPILOT_QUERY_HARD_CEILING_RATIO })).toBe(
      'paused',
    );
  });

  it('modo pause para tudo no teto', () => {
    expect(computeBudgetState({ ...base, mode: 'pause', spentUsd: 30 })).toBe('paused');
    expect(computeBudgetState({ ...base, mode: 'pause', spentUsd: 29 })).toBe('alert');
  });

  it('teto zero = nada a gastar; valor corrompido falha fechado', () => {
    expect(computeBudgetState({ ...base, capUsd: 0, spentUsd: 0 })).toBe('paused');
    expect(computeBudgetState({ ...base, spentUsd: Number.NaN })).toBe('paused');
  });

  it('o teto duro provisório é 120 % (constante nomeada)', () => {
    expect(COPILOT_QUERY_HARD_CEILING_RATIO).toBe(1.2);
  });

  it('zera no 1º dia do mês seguinte (UTC)', () => {
    expect(budgetResetsOn(new Date('2026-10-17T12:00:00Z'))).toBe('2026-11-01');
    expect(budgetResetsOn(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01');
  });
});
