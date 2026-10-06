/**
 * SEC-02: o interruptor de bypass (MockAuthProvider, aceita qualquer senha) não
 * pode existir em produção — nem por override explícito (AUTH_PROVIDER=mock) nem
 * por fallback silencioso (chaves Supabase ausentes/placeholder). Fail-fast.
 *
 * F71-S02: regra do destino dos links de email e os verbos de conta do mock.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { resolveEmailRedirect } from '@hm/shared';
import { MockAuthProvider, mockVerifyToken } from './mock-provider';
import { getAuthProvider, __resetAuthProviderCache } from './provider';

afterEach(() => {
  vi.unstubAllEnvs();
  __resetAuthProviderCache();
});

describe('getAuthProvider — fail-fast em produção (SEC-02)', () => {
  it('produção + AUTH_PROVIDER=mock → lança erro claro no boot', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', 'mock');
    expect(() => getAuthProvider()).toThrowError(/AUTH_PROVIDER=mock em produção/);
  });

  it('produção sem chaves Supabase válidas → lança (recusa fallback para mock)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', 'https://your-project.supabase.co'); // placeholder
    vi.stubEnv('SUPABASE_ANON_KEY', 'your-anon-key');
    expect(() => getAuthProvider()).toThrowError(/Recusando/);
  });

  it('produção com chaves Supabase válidas → SupabaseAuthProvider', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', 'https://abc123.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-real');
    expect(getAuthProvider().kind).toBe('supabase');
  });

  it('fora de produção AUTH_PROVIDER=mock segue permitido (dev local)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PROVIDER', 'mock');
    expect(getAuthProvider().kind).toBe('mock');
  });

  it('fora de produção sem chaves → fallback mock (dev sem Supabase)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    expect(getAuthProvider().kind).toBe('mock');
  });
});

describe('resolveEmailRedirect — o link do email nunca sai do app', () => {
  const base = 'https://app.leadium.com.br/';

  it('caminho do app vira URL absoluta na base', () => {
    expect(resolveEmailRedirect('/convite/abc', base)).toBe(
      'https://app.leadium.com.br/convite/abc',
    );
  });

  it('URL absoluta na mesma origem é aceita', () => {
    expect(resolveEmailRedirect('https://app.leadium.com.br/verify', base)).toBe(
      'https://app.leadium.com.br/verify',
    );
  });

  it.each([
    ['outra origem', 'https://evil.com/convite/abc'],
    ['subdomínio parecido', 'https://app.leadium.com.br.evil.com/x'],
    ['relativo ao protocolo', '//evil.com/x'],
    ['barra invertida', '/\\evil.com'],
    ['espaço', '/convite/a b'],
    ['quebra de linha', '/convite/a\nb'],
    ['esquema javascript', 'javascript:alert(1)'],
    ['credenciais na URL', 'https://user:pw@app.leadium.com.br/x'],
    ['caminho relativo', 'convite/abc'],
    ['vazio', ''],
    ['longo demais', `/${'a'.repeat(2048)}`],
  ])('recusa: %s', (_label, target) => {
    expect(resolveEmailRedirect(target, base)).toBeNull();
  });

  it('sem base ou base inválida → recusa', () => {
    expect(resolveEmailRedirect('/convite/abc', undefined)).toBeNull();
    expect(resolveEmailRedirect('/convite/abc', 'not a url')).toBeNull();
    expect(resolveEmailRedirect('/convite/abc', 'ftp://app.leadium.com.br')).toBeNull();
  });
});

describe('MockAuthProvider — verbos de conta da F71 (em memória)', () => {
  it('signUp → conta sem email confirmado; login recusa com email_unverified', async () => {
    const mock = new MockAuthProvider();
    const { authUserId } = await mock.signUp({ email: 'Ana@X.com', password: 'x' });
    await expect(mock.findUserByEmail('ana@x.com')).resolves.toEqual({
      authUserId,
      emailConfirmed: false,
      hasPassword: true,
    });
    await expect(mock.signIn({ email: 'ana@x.com', password: 'x' })).rejects.toMatchObject({
      code: 'email_unverified',
    });
    await mock.verifyEmailToken(mockVerifyToken('ana@x.com'));
    const after = await mock.findUserByEmail('ana@x.com');
    expect(after?.emailConfirmed).toBe(true);
  });

  it('lookup é por email exato', async () => {
    const mock = new MockAuthProvider();
    await mock.signUp({ email: 'joana@x.com', password: 'x' });
    await expect(mock.findUserByEmail('ana@x.com')).resolves.toBeNull();
  });

  it('sendInvite: sem conta → convite (sem senha); completeAccount ativa', async () => {
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', '');
    const mock = new MockAuthProvider();
    const invite = await mock.sendInvite('bia@x.com', '/convite/tok');
    expect(invite.channel).toBe('invite');
    const sent = mock.outbox.at(-1);
    expect(sent).toMatchObject({
      kind: 'invite',
      email: 'bia@x.com',
      redirectTo: 'http://localhost:3000/convite/tok',
      proofType: 'invite',
    });
    // O botão do email leva a prova de posse da caixa no FRAGMENTO, nunca na query
    // (runbook §4.3: o fragmento não vai ao servidor, a log nem ao Referer).
    expect(new URL(sent?.link ?? 'http://x').search).toBe('');
    expect(sent?.link).toBe(
      `http://localhost:3000/convite/tok#token_hash=${sent?.tokenHash ?? ''}&type=invite`,
    );
    await expect(mock.findUserByEmail('bia@x.com')).resolves.toEqual({
      authUserId: invite.authUserId,
      emailConfirmed: false,
      hasPassword: false,
    });
    await expect(mock.completeAccount(invite.authUserId, 'S3nha!')).resolves.toBe(true);
    await expect(mock.findUserByEmail('bia@x.com')).resolves.toMatchObject({
      emailConfirmed: true,
      hasPassword: true,
    });
  });

  it('sendInvite para email já confirmado → link de acesso com o id existente', async () => {
    const mock = new MockAuthProvider();
    const { authUserId } = await mock.signUp({ email: 'cai@x.com', password: 'x' });
    await mock.verifyEmailToken(mockVerifyToken('cai@x.com'));
    await expect(mock.sendInvite('cai@x.com', '/convite/t')).resolves.toEqual({
      authUserId,
      channel: 'sign_in_link',
    });
    expect(mock.outbox.at(-1)?.kind).toBe('sign_in_link');
  });

  it('sendSignInLink: sem conta resolve sem enviar; destino fora do app lança', async () => {
    const mock = new MockAuthProvider();
    await expect(mock.sendSignInLink('ninguem@x.com', '/convite/t')).resolves.toBeUndefined();
    expect(mock.outbox).toHaveLength(0);
    await expect(mock.sendSignInLink('a@x.com', 'https://evil.com/')).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('updatePassword/completeAccount de id desconhecido → false', async () => {
    const mock = new MockAuthProvider();
    await expect(mock.updatePassword('nao-existe', 'x')).resolves.toBe(false);
    await expect(mock.completeAccount('nao-existe', 'x')).resolves.toBe(false);
    const { authUserId } = await mock.signUp({ email: 'd@x.com', password: 'x' });
    await expect(mock.updatePassword(authUserId, 'y')).resolves.toBe(true);
  });

  it('verifyEmailOwnership: só o token_hash que saiu no email, do mesmo tipo, uma vez', async () => {
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', '');
    const mock = new MockAuthProvider();
    const { authUserId } = await mock.sendInvite('eva@x.com', '/convite/t1');
    const first = mock.outbox.at(-1);
    if (!first) throw new Error('sem email');
    // Tipo errado, hash inventado → null (e não consome).
    await expect(mock.verifyEmailOwnership(first.tokenHash, 'magiclink')).resolves.toBeNull();
    await expect(mock.verifyEmailOwnership('f'.repeat(56), 'invite')).resolves.toBeNull();

    // Envio novo invalida o anterior.
    await mock.sendInvite('eva@x.com', '/convite/t2');
    const second = mock.outbox.at(-1);
    if (!second) throw new Error('sem email');
    await expect(mock.verifyEmailOwnership(first.tokenHash, 'invite')).resolves.toBeNull();

    await expect(mock.verifyEmailOwnership(second.tokenHash, 'invite')).resolves.toEqual({
      authUserId,
      email: 'eva@x.com',
    });
    await expect(mock.findUserByEmail('eva@x.com')).resolves.toMatchObject({ emailConfirmed: true });
    // Reuso → null.
    await expect(mock.verifyEmailOwnership(second.tokenHash, 'invite')).resolves.toBeNull();
  });

  it('verifyEmailOwnership: link de acesso → type magiclink', async () => {
    const mock = new MockAuthProvider();
    const { authUserId } = await mock.signUp({ email: 'fe@x.com', password: 'x' });
    await mock.sendSignInLink('fe@x.com', '/convite/t');
    const mail = mock.outbox.at(-1);
    expect(mail?.proofType).toBe('magiclink');
    await expect(mock.verifyEmailOwnership(mail?.tokenHash ?? '', 'magiclink')).resolves.toEqual({
      authUserId,
      email: 'fe@x.com',
    });
  });
});
