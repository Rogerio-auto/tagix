import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import {
  AuthError,
  resolveEmailRedirect,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type AuthUserLookup,
  type EmailProofType,
  type IAccountAuthProvider,
  type InviteResult,
  type SignUpResult,
} from '@hm/shared';

interface MockTokenPayload {
  authUserId: string;
  email: string;
  iat: number;
}

/** Conta conhecida pelo mock (só memória, por processo). */
interface MockUser {
  authUserId: string;
  email: string;
  emailConfirmed: boolean;
  hasPassword: boolean;
}

/** Email que o provider real mandaria. Em dev nada sai; fica aqui para teste e debug. */
export interface MockAuthEmail {
  kind: 'invite' | 'sign_in_link';
  email: string;
  /** Destino (`{{ .RedirectTo }}`), sem a prova. */
  redirectTo: string;
  /** `{{ .TokenHash }}` deste envio: prova de posse da caixa, uso único. */
  tokenHash: string;
  /** `type` que o template põe na URL (`invite` ou `magiclink`). */
  proofType: EmailProofType;
  /**
   * URL que o botão do email abre: `<redirectTo>#token_hash=…&type=…` (runbook §4). A prova
   * vai no FRAGMENTO: o navegador não o manda ao servidor nem no Referer (não cai em log).
   */
  link: string;
}

/** `token_hash` emitido por um envio do mock, aceito uma vez. */
interface MockProof {
  email: string;
  type: EmailProofType;
  used: boolean;
}

/** Teto da caixa de saída em memória (processo de dev longo não cresce sem limite). */
const OUTBOX_LIMIT = 100;

/**
 * Provider de auth para dev (sem Supabase). Aceita qualquer senha para uma pessoa que
 * tenha member em alguma empresa: o email só serve para achar o `auth_user_id` (como o
 * GoTrue faz no login); a empresa e a membership são resolvidas depois, por
 * `auth_user_id`, pela sessão (F71-S03). Token = payload base64url (não assinado — só dev).
 * Nunca em produção: `getAuthProvider` aborta o boot (SEC-02).
 *
 * Contas em memória: `signUp`, `sendInvite`, `verifyEmailToken`, `completeAccount` e o
 * próprio login mantêm um registro por email, com a mesma semântica do real (signup nasce
 * sem email confirmado; convite nasce sem senha; login de conta não confirmada recusa
 * com `email_unverified`). Nada persiste. A senha nunca é logada nem guardada.
 */
export class MockAuthProvider implements IAccountAuthProvider {
  /** email normalizado → conta. */
  private readonly users = new Map<string, MockUser>();

  /** Emails que teriam saído (mais recentes no fim). */
  readonly outbox: MockAuthEmail[] = [];

  /** token_hash → prova (só os emitidos pelo `record`). */
  private readonly proofs = new Map<string, MockProof>();

  readonly kind = 'mock' as const;

  async signIn({ email }: AuthCredentials): Promise<AuthSession> {
    const known = this.users.get(normalizeEmail(email));
    // Paridade com o GoTrue: a "senha" do mock sempre confere, então a recusa por
    // email não confirmado vem depois dela (não enumera).
    if (known && !known.emailConfirmed) {
      throw new AuthError('Email não confirmado.', 'email_unverified');
    }
    const authUserId = known?.authUserId ?? (await findPersonByEmail(email));
    if (!authUserId) throw new AuthError('Credenciais inválidas.', 'invalid_credentials');
    const identity: AuthIdentity = { authUserId, email: normalizeEmail(email) };
    // Quem entrou passa a ser conta conhecida (convite para ela vira link de acesso).
    if (!known) {
      this.users.set(identity.email, {
        authUserId,
        email: identity.email,
        emailConfirmed: true,
        hasPassword: true,
      });
    }
    const payload: MockTokenPayload = { ...identity, iat: Date.now() };
    const accessToken = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { accessToken, identity, expiresAt: null };
  }

  async verifyToken(token: string): Promise<AuthIdentity | null> {
    try {
      const payload = JSON.parse(
        Buffer.from(token, 'base64url').toString('utf8'),
      ) as MockTokenPayload;
      if (!payload.authUserId || !payload.email) return null;
      return { authUserId: payload.authUserId, email: payload.email };
    } catch {
      return null; // token malformado
    }
  }

  async signOut(): Promise<void> {
    // stateless: o logout limpa o cookie no servidor.
  }

  /** Idempotente por email (em memória). Não confirma email — paridade com o real. */
  async signUp({ email }: AuthCredentials): Promise<SignUpResult> {
    const normalized = normalizeEmail(email);
    const existing = this.users.get(normalized);
    if (existing) return { authUserId: existing.authUserId, created: false };
    const id = randomUUID();
    this.users.set(normalized, {
      authUserId: id,
      email: normalized,
      emailConfirmed: false,
      hasPassword: true,
    });
    return { authUserId: id, created: true };
  }

  async requestPasswordReset(): Promise<void> {
    // dev: sem provedor de email; sempre resolve (anti-enumeração).
  }

  async resendVerification(): Promise<void> {
    // dev: sem provedor de email; sempre resolve.
  }

  /**
   * Em dev, o token de verificação é o email codificado em base64url
   * (`mockVerifyToken(email)`). Aceita-o, confirma a conta conhecida e devolve a identidade.
   */
  async verifyEmailToken(token: string): Promise<AuthIdentity | null> {
    try {
      const email = normalizeEmail(Buffer.from(token, 'base64url').toString('utf8'));
      if (!email.includes('@')) return null;
      const known = this.users.get(email);
      if (known) known.emailConfirmed = true;
      // Processo reiniciado entre o signup e o clique: a "conta" sumiu da memória, mas o
      // member provisionado guarda o `auth_user_id` (o real o teria no GoTrue).
      const authUserId = known?.authUserId ?? (await findPersonByEmail(email)) ?? randomUUID();
      return { authUserId, email };
    } catch {
      return null;
    }
  }

  /**
   * dev: aceita um token de recuperação bem-formado (base64url de um email) e
   * "troca" a senha (só marca a conta conhecida como tendo senha). Malformado → false.
   */
  async confirmPasswordReset(token: string): Promise<boolean> {
    try {
      const email = normalizeEmail(Buffer.from(token, 'base64url').toString('utf8'));
      if (!email.includes('@')) return false;
      const known = this.users.get(email);
      if (known) known.hasPassword = true;
      return true;
    } catch {
      return false;
    }
  }

  async findUserByEmail(email: string): Promise<AuthUserLookup | null> {
    const known = this.users.get(normalizeEmail(email));
    if (!known) return null;
    return {
      authUserId: known.authUserId,
      emailConfirmed: known.emailConfirmed,
      hasPassword: known.hasPassword,
    };
  }

  /** Paridade com o GoTrue: conta confirmada → link de acesso; senão (re)convida. */
  async sendInvite(email: string, redirectTo: string): Promise<InviteResult> {
    const target = requireRedirect(redirectTo);
    const normalized = normalizeEmail(email);
    const known = this.users.get(normalized);
    if (known?.emailConfirmed) {
      this.record({ kind: 'sign_in_link', email: normalized, redirectTo: target });
      return { authUserId: known.authUserId, channel: 'sign_in_link' };
    }
    const user: MockUser = known ?? {
      authUserId: randomUUID(),
      email: normalized,
      emailConfirmed: false,
      hasPassword: false,
    };
    this.users.set(normalized, user);
    this.record({ kind: 'invite', email: normalized, redirectTo: target });
    return { authUserId: user.authUserId, channel: 'invite' };
  }

  /** Sem conta → resolve em silêncio, sem "enviar" (anti-enumeração, como o real). */
  async sendSignInLink(email: string, redirectTo: string): Promise<void> {
    const target = requireRedirect(redirectTo);
    const normalized = normalizeEmail(email);
    if (!this.users.has(normalized)) return;
    this.record({ kind: 'sign_in_link', email: normalized, redirectTo: target });
  }

  async completeAccount(authUserId: string, _password: string): Promise<boolean> {
    const user = this.findById(authUserId);
    if (!user) return false;
    user.hasPassword = true;
    user.emailConfirmed = true;
    return true;
  }

  async updatePassword(authUserId: string, _password: string): Promise<boolean> {
    const user = this.findById(authUserId);
    if (!user) return false;
    user.hasPassword = true;
    return true;
  }

  private findById(authUserId: string): MockUser | undefined {
    for (const user of this.users.values()) {
      if (user.authUserId === authUserId) return user;
    }
    return undefined;
  }

  /**
   * Prova de posse: só aceita um `token_hash` que saiu num email deste mock, do mesmo tipo,
   * uma vez. Paridade com o GoTrue: verificar confirma o email; um envio mais novo para o
   * mesmo endereço invalida o anterior (o `record` apaga as provas antigas).
   */
  async verifyEmailOwnership(tokenHash: string, type: EmailProofType): Promise<AuthIdentity | null> {
    const proof = this.proofs.get(tokenHash);
    if (!proof || proof.used || proof.type !== type) return null;
    proof.used = true;
    const user = this.users.get(proof.email);
    if (!user) return null;
    user.emailConfirmed = true;
    return { authUserId: user.authUserId, email: user.email };
  }

  private record(mail: Omit<MockAuthEmail, 'tokenHash' | 'proofType' | 'link'>): void {
    const proofType: EmailProofType = mail.kind === 'invite' ? 'invite' : 'magiclink';
    for (const [hash, proof] of this.proofs) {
      if (proof.email === mail.email) this.proofs.delete(hash);
    }
    const tokenHash = randomBytes(28).toString('hex');
    this.proofs.set(tokenHash, { email: mail.email, type: proofType, used: false });
    if (this.proofs.size > OUTBOX_LIMIT) {
      const oldest = this.proofs.keys().next();
      if (!oldest.done) this.proofs.delete(oldest.value);
    }
    const link = new URL(mail.redirectTo);
    link.hash = new URLSearchParams({ token_hash: tokenHash, type: proofType }).toString();
    this.outbox.push({ ...mail, tokenHash, proofType, link: link.toString() });
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
  }
}

/**
 * O `auth_user_id` da pessoa com este email — o papel do diretório de usuários do GoTrue,
 * que o mock não tem. Linhas `members` da mesma pessoa compartilham o `auth_user_id`;
 * havendo mais de um (resto de convite antigo com id aleatório), vence o de linha
 * `active`, depois a empresa usada por último. Só identifica a pessoa: nunca decide
 * empresa nem membership (isso é da sessão, por `auth_user_id`).
 */
async function findPersonByEmail(email: string): Promise<string | null> {
  const { members } = schema;
  const [row] = await getDb()
    .select({ authUserId: members.authUserId })
    .from(members)
    .where(eq(members.email, normalizeEmail(email)))
    .orderBy(
      sql`(${members.status} = 'active') desc`,
      sql`${members.lastActiveAt} desc nulls last`,
      asc(members.createdAt),
    )
    .limit(1);
  return row?.authUserId ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mesma regra do real: destino dentro do app. Sem `AUTH_EMAIL_REDIRECT_URL` em dev,
 * usa a origem local do web para o link continuar navegável.
 */
function requireRedirect(redirectTo: string): string {
  const base = process.env['AUTH_EMAIL_REDIRECT_URL'] || 'http://localhost:3000';
  const target = resolveEmailRedirect(redirectTo, base);
  if (!target) {
    throw new AuthError('Destino do link de email recusado (fora do app).', 'provider_error');
  }
  return target;
}

/** Helper de teste/dev: gera o token de verificação aceito pelo MockAuthProvider. */
export function mockVerifyToken(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), 'utf8').toString('base64url');
}
