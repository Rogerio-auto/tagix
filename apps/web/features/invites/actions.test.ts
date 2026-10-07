import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/lib/api-client';
import { describeInviteError, runCopyLink, runCreate, runResend, runRevoke } from './actions';
import type { PublicInvite } from './types';

const invite: PublicInvite = {
  id: 'i1',
  email: 'bia@acme.com',
  role: 'AGENT',
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-08T00:00:00.000Z',
  expired: false,
  lastSentAt: null,
  sendCount: 1,
  resendsLeft: 5,
};

const apiErr = (status: number, code: string) => new ApiError(status, 'x', undefined, undefined, code);

describe('criar convite', () => {
  it('toast "Convite enviado para x@y.com" só com delivery sent', async () => {
    const out = await runCreate(
      { create: async () => ({ invite, delivery: 'sent' as const }) },
      { email: 'bia@acme.com', role: 'AGENT' },
    );
    expect(out).toMatchObject({ ok: true, variant: 'success', title: 'Convite enviado para bia@acme.com' });
  });

  it('delivery failed: avisa que o email não saiu e manda copiar o link (nunca "enviado")', async () => {
    const out = await runCreate(
      { create: async () => ({ invite, delivery: 'failed' as const }) },
      { email: 'bia@acme.com', role: 'AGENT' },
    );
    expect(out.variant).toBe('warn');
    expect(out.title).toBe('Convite criado, mas o email não saiu');
    expect(out.title).not.toContain('enviado');
    expect(out.description).toContain('Copie o link');
  });

  it('limite de vagas (402 seat_limit): CTA para o plano', async () => {
    const out = await runCreate(
      { create: async () => Promise.reject(apiErr(402, 'seat_limit')) },
      { email: 'bia@acme.com', role: 'AGENT' },
    );
    expect(out).toMatchObject({ ok: false, billingCta: true, title: 'Limite de membros atingido' });
  });

  it('409 already_member e member_blocked têm texto próprio', () => {
    expect(describeInviteError(apiErr(409, 'already_member'), 'create').title).toContain('já faz parte');
    expect(describeInviteError(apiErr(409, 'member_blocked'), 'create').title).toContain('bloqueada');
  });
});

describe('reenviar', () => {
  it('sucesso: "Convite reenviado para …"', async () => {
    const resend = vi.fn(async () => ({ invite, delivery: 'sent' as const }));
    const out = await runResend({ resend }, 'i1', 'bia@acme.com');
    expect(resend).toHaveBeenCalledWith('i1');
    expect(out).toMatchObject({ variant: 'success', title: 'Convite reenviado para bia@acme.com' });
  });

  it('cooldown (429) manda aguardar, sem CTA de plano', async () => {
    const out = await runResend(
      { resend: async () => Promise.reject(apiErr(429, 'resend_cooldown')) },
      'i1',
      'a@b.c',
    );
    expect(out.variant).toBe('warn');
    expect(out.billingCta).toBeUndefined();
  });

  it('402 seat_limit em convite vencido: CTA para o plano', async () => {
    const out = await runResend(
      { resend: async () => Promise.reject(apiErr(402, 'seat_limit')) },
      'i1',
      'a@b.c',
    );
    expect(out.billingCta).toBe(true);
  });
});

describe('revogar', () => {
  it('204: confirma e diz que o link morreu', async () => {
    const revoke = vi.fn(async () => undefined);
    const out = await runRevoke({ revoke }, 'i1', 'bia@acme.com');
    expect(revoke).toHaveBeenCalledWith('i1');
    expect(out).toMatchObject({ variant: 'success', title: 'Convite revogado' });
    expect(out.description).toContain('bia@acme.com');
  });

  it('404: o convite já não existe (info, não erro)', async () => {
    const out = await runRevoke(
      { revoke: async () => Promise.reject(apiErr(404, 'invite_not_found')) },
      'i1',
      'a@b.c',
    );
    expect(out.variant).toBe('info');
  });
});

describe('copiar link', () => {
  const link = async () => ({
    url: 'https://app.test/convite/NOVO',
    expiresAt: '2026-10-08T00:00:00.000Z',
    invite,
  });

  it('copia a URL nova e avisa que o link anterior morreu', async () => {
    const writeText = vi.fn(async () => undefined);
    const res = await runCopyLink({ link }, { writeText }, 'i1');
    expect(writeText).toHaveBeenCalledWith('https://app.test/convite/NOVO');
    expect(res.outcome).toMatchObject({ variant: 'success', title: 'Link copiado' });
    expect(res.manualUrl).toBeUndefined();
  });

  it('clipboard recusado: devolve a URL para copiar à mão (não perde o link)', async () => {
    const res = await runCopyLink(
      { link },
      { writeText: async () => Promise.reject(new Error('denied')) },
      'i1',
    );
    expect(res.manualUrl).toBe('https://app.test/convite/NOVO');
    expect(res.outcome.variant).toBe('info');
  });

  it('sem clipboard no ambiente: também cai no manual', async () => {
    const res = await runCopyLink({ link }, null, 'i1');
    expect(res.manualUrl).toBeDefined();
  });

  it('503 link_unavailable: erro explicado', async () => {
    const res = await runCopyLink(
      { link: async () => Promise.reject(apiErr(503, 'link_unavailable')) },
      null,
      'i1',
    );
    expect(res.outcome.variant).toBe('error');
    expect(res.manualUrl).toBeUndefined();
  });
});

describe('reativar (PATCH status active)', () => {
  it('402 seat_limit usa o texto de reativação com CTA', () => {
    const out = describeInviteError(apiErr(402, 'seat_limit'), 'reactivate');
    expect(out.description).toContain('reativar');
    expect(out.billingCta).toBe(true);
  });
  it('409 invite_pending explica', () => {
    expect(describeInviteError(apiErr(409, 'invite_pending'), 'reactivate').title).toContain(
      'convite pendente',
    );
  });
});
