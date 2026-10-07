import { describe, expect, it } from 'vitest';
import { createdLoginHref, loginHrefFor, resolveStage, type StageInput } from './stage';
import type { InvitePreview } from './types';

const base: InvitePreview = {
  workspaceName: 'Acme',
  inviterName: 'Ana',
  role: 'AGENT',
  emailMasked: 'b***@acme.com',
  requiresEmailProof: false,
  expiresAt: '2026-12-01T00:00:00.000Z',
};

function input(over: Partial<StageInput> = {}): StageInput {
  return {
    preview: base,
    session: { status: 'ready', email: 'bia@acme.com' },
    proof: null,
    sentEmailMasked: null,
    loginRequired: false,
    wrongAccount: false,
    createdNext: null,
    ...over,
  };
}

describe('resolveStage', () => {
  it('(a) conta com senha + logado: botão de aceitar', () => {
    expect(resolveStage(input())).toEqual({ kind: 'accept', sessionEmail: 'bia@acme.com' });
  });

  it('(b) conta com senha, deslogado: entrar para aceitar', () => {
    expect(resolveStage(input({ session: { status: 'ready', email: null } }))).toEqual({ kind: 'login' });
    expect(resolveStage(input({ loginRequired: true }))).toEqual({ kind: 'login' });
  });

  it('(c) 403 wrong_account: explica e oferece sair', () => {
    expect(resolveStage(input({ wrongAccount: true }))).toEqual({
      kind: 'wrong-account',
      sessionEmail: 'bia@acme.com',
    });
  });

  it('espera a sessão antes de decidir (sem piscar o estado errado)', () => {
    expect(resolveStage(input({ session: { status: 'loading' } }))).toBeNull();
  });

  it('(d) exige prova + fragmento válido: formulário de senha', () => {
    const preview = { ...base, requiresEmailProof: true };
    expect(
      resolveStage(input({ preview, proof: { tokenHash: 'abcdefgh12', type: 'invite' } })),
    ).toEqual({ kind: 'create-password' });
  });

  it('(e) exige prova sem fragmento: enviar email; depois, aguardar o link', () => {
    const preview = { ...base, requiresEmailProof: true };
    expect(resolveStage(input({ preview }))).toEqual({ kind: 'send-proof' });
    expect(resolveStage(input({ preview, sentEmailMasked: 'b***@acme.com' }))).toEqual({
      kind: 'proof-sent',
      emailMasked: 'b***@acme.com',
    });
  });

  it('fragmento ainda não lido: pendente', () => {
    const preview = { ...base, requiresEmailProof: true };
    expect(resolveStage(input({ preview, proof: undefined }))).toBeNull();
  });

  it('conta criada: leva ao login', () => {
    expect(resolveStage(input({ createdNext: '/login?email=x' }))).toEqual({
      kind: 'created',
      next: '/login?email=x',
    });
  });

  it('o login volta ao convite (next codificado)', () => {
    expect(loginHrefFor('a/b c')).toBe('/login?next=%2Fconvite%2Fa%2Fb%20c');
  });
});

describe('createdLoginHref', () => {
  it('anexa from=invite ao login devolvido pela API, preservando o email', () => {
    expect(createdLoginHref('/login?email=bia%40acme.com')).toBe('/login?email=bia%40acme.com&from=invite');
  });

  it('sobrescreve um from= vindo da API (um só marcador)', () => {
    expect(createdLoginHref('/login?from=verify&email=a%40b.co')).toBe('/login?from=invite&email=a%40b.co');
  });

  it('sem next: cai no login com o marcador', () => {
    expect(createdLoginHref(undefined)).toBe('/login?from=invite');
  });

  it('externo ou protocol-relative: cai no login interno', () => {
    expect(createdLoginHref('https://evil.example/login?email=x')).toBe('/login?from=invite');
    expect(createdLoginHref('//evil.example/login')).toBe('/login?from=invite');
    expect(createdLoginHref('/\\evil.example')).toBe('/login?from=invite');
  });

  it('outro caminho interno segue intocado (sem marcador)', () => {
    expect(createdLoginHref('/inbox?x=1')).toBe('/inbox?x=1');
  });
});
