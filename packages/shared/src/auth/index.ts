/**
 * Contrato de autenticação. O backend implementa `IAuthProvider` com um adapter
 * Supabase (quando configurado) ou um mock (dev). O resto da app só conhece a interface.
 */

export interface AuthCredentials {
  email: string;
  password: string;
}

/** Identidade verificada (ref ao usuário no provider externo). */
export interface AuthIdentity {
  authUserId: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  identity: AuthIdentity;
  /** epoch ms; null = sem expiração explícita (mock). */
  expiresAt: number | null;
}

/**
 * Resultado de `signUp`. `created:false` quando o email já existe no provider —
 * idempotente e **anti-enumeração**: o caller NUNCA expõe esse bit ao cliente
 * (responde sempre de forma uniforme). Nunca lança por email duplicado.
 */
export interface SignUpResult {
  authUserId: string;
  created: boolean;
}

/**
 * Conta encontrada no provider por email EXATO (comparação case-insensitive do
 * endereço inteiro; nunca por trecho). Uso server-side: o caller NUNCA devolve esse
 * objeto, nem a presença/ausência dele, a um cliente não autenticado.
 */
export interface AuthUserLookup {
  authUserId: string;
  /** O dono do endereço já provou o controle da caixa (link de confirmação/convite). */
  emailConfirmed: boolean;
  /**
   * A conta tem senha própria. `false` = conta criada por convite que ainda não foi
   * completada (`completeAccount`). Derivado do provider: o GoTrue não expõe o hash,
   * então o adapter usa a marca que ele mesmo grava ao definir senha e, para contas
   * antigas sem a marca, "não foi criada por convite".
   */
  hasPassword: boolean;
}

/** Resultado de `sendInvite`. */
export interface InviteResult {
  /** Id da conta no provider (nova, ou a existente quando o email já tinha conta). */
  authUserId: string;
  /**
   * Qual email saiu: `invite` (template "Invite user") ou `sign_in_link` (template
   * "Magic link", quando a conta passou a existir no meio do caminho). Para auditoria.
   */
  channel: 'invite' | 'sign_in_link';
}

export interface IAuthProvider {
  readonly kind: 'supabase' | 'mock';

  /**
   * Login por senha. Lança `AuthError`:
   *  - `invalid_credentials`: email inexistente OU senha errada (indistinguíveis);
   *  - `email_unverified`: a senha CONFERE, mas o email não foi confirmado. O provider
   *    só chega nesse veredito depois de aceitar a senha, então ele não enumera contas
   *    (quem não sabe a senha recebe `invalid_credentials`);
   *  - `provider_error`: indisponibilidade (rede/5xx); não é falha de credencial.
   */
  signIn(credentials: AuthCredentials): Promise<AuthSession>;
  verifyToken(token: string): Promise<AuthIdentity | null>;
  signOut(token: string): Promise<void>;

  /**
   * Cria o usuário no provider com **email NÃO confirmado** (`email_confirm:false`).
   * Bloqueio duro: o usuário não acessa o app até confirmar o email (F44 §2.1).
   * Idempotente: email já existente → `{ created:false }`, sem lançar.
   * A senha nunca é logada (T6).
   */
  signUp(credentials: AuthCredentials): Promise<SignUpResult>;

  /**
   * Dispara o email de redefinição de senha. **Sempre resolve** (anti-enumeração T3):
   * nunca sinaliza se o email existe ou não.
   */
  requestPasswordReset(email: string): Promise<void>;

  /**
   * Reenvia o email de verificação de cadastro. **Sempre resolve** (anti-enumeração).
   */
  resendVerification(email: string): Promise<void>;

  /**
   * Valida o token de verificação de email (vindo do link). Retorna a identidade
   * confirmada ou `null` se inválido/expirado. Não lança para token inválido.
   */
  verifyEmailToken(token: string): Promise<AuthIdentity | null>;

  /**
   * Confirma a redefinição de senha: valida o token de recuperação (do link de
   * email) e troca a senha. Retorna `true` em sucesso; `false` se o token for
   * inválido/expirado. Não lança. A senha nova nunca é logada (T6).
   */
  confirmPasswordReset(token: string, newPassword: string): Promise<boolean>;
}

/**
 * Contrato completo da F71: `IAuthProvider` + os verbos de conta usados por convite e
 * cadastro completo. É o tipo que `getAuthProvider()` devolve; as implementações reais
 * (Supabase e mock) cumprem este contrato.
 *
 * Fica separado de `IAuthProvider` para que dublês de teste que só exercitam login e
 * cadastro não precisem implementar convite.
 */
export interface IAccountAuthProvider extends IAuthProvider {
  /**
   * Procura a conta pelo email EXATO (case-insensitive, endereço inteiro). Um email que
   * apenas contém o outro (`ana@x.com` × `joana@x.com`) nunca casa.
   *
   * Anti-enumeração: método **server-side**. O resultado decide qual email mandar ou
   * qual caminho seguir, mas a resposta HTTP de rotas públicas continua uniforme
   * (mesmo corpo e tempo) exista a conta ou não.
   *
   * `null` = não existe. LANÇA `AuthError('provider_error')` quando não dá para saber
   * (rede/5xx, service key ausente): "não sei" nunca vira "não existe".
   */
  findUserByEmail(email: string): Promise<AuthUserLookup | null>;

  /**
   * Convida quem NÃO tem conta: cria a conta sem senha e manda o email "Invite user"
   * apontando para `redirectTo`.
   *
   * `redirectTo` é um caminho do app (`/convite/<token>`) ou uma URL absoluta na MESMA
   * origem de `AUTH_EMAIL_REDIRECT_URL` (regras em `resolveEmailRedirect`). Qualquer
   * outro destino, ou base não configurada, LANÇA `AuthError('provider_error')` antes de
   * enviar: o link do email nunca aponta para fora do app nem perde o token do caminho.
   *
   * Corrida (a conta passou a existir entre o `findUserByEmail` e o envio): não lança;
   * cai para o email de acesso (`sendSignInLink`) e devolve o id da conta existente.
   * Falha de envio/infra → `AuthError('provider_error')`, para a rota oferecer o link
   * copiável.
   */
  sendInvite(email: string, redirectTo: string): Promise<InviteResult>;

  /**
   * Manda o email de acesso ("Magic link") a quem JÁ tem conta, apontando para
   * `redirectTo` (mesmas regras de `sendInvite`). Nunca cria conta.
   *
   * Anti-enumeração: email sem conta → resolve em silêncio, sem enviar nada.
   * Falha de envio/infra (rate limit, 5xx) → `AuthError('provider_error')`.
   */
  sendSignInLink(email: string, redirectTo: string): Promise<void>;

  /**
   * Completa a conta criada por convite: define a senha e marca o email como
   * confirmado (quem abriu o link provou o controle da caixa). `true` em sucesso;
   * `false` se a conta não existe, o id é inválido ou o provider recusou (ex.: senha
   * fraca). Não lança. A senha nunca é logada.
   */
  completeAccount(authUserId: string, password: string): Promise<boolean>;

  /**
   * Troca a senha de uma conta existente (usuário autenticado). Não mexe na
   * confirmação do email. A verificação da senha atual, se exigida, é da rota.
   * `true` em sucesso; `false` em falha. Não lança. A senha nunca é logada.
   */
  updatePassword(authUserId: string, password: string): Promise<boolean>;
}

/** Teto de tamanho do destino de um link de email (evita URL abusiva no template). */
const MAX_REDIRECT_LENGTH = 2048;

/**
 * Resolve o destino de um link de email contra a base do app (`AUTH_EMAIL_REDIRECT_URL`).
 *
 * Aceita:
 *  - caminho do app (`/convite/abc`), que vira `<base>/convite/abc`;
 *  - URL absoluta cuja origem é EXATAMENTE a origem da base.
 *
 * Devolve `null` (destino recusado) para: base ausente ou inválida, caminho relativo
 * ao protocolo (`//evil.com`), barra invertida, espaço/controle, outra origem, outro
 * esquema, ou tamanho acima do teto. O link de um email nunca aponta para fora do app.
 */
export function resolveEmailRedirect(redirectTo: string, base: string | undefined): string | null {
  if (!base || redirectTo.length === 0 || redirectTo.length > MAX_REDIRECT_LENGTH) return null;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return null;
  }
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') return null;
  // Espaço, controle e barra invertida não têm uso legítimo aqui e abrem truques de parser.
  for (const ch of redirectTo) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || ch === '\\' || /\s/.test(ch)) return null;
  }

  if (redirectTo.startsWith('/')) {
    if (redirectTo.startsWith('//')) return null;
    return baseUrl.origin + baseUrl.pathname.replace(/\/+$/, '') + redirectTo;
  }

  let target: URL;
  try {
    target = new URL(redirectTo);
  } catch {
    return null;
  }
  if (target.origin !== baseUrl.origin || target.username || target.password) return null;
  return target.toString();
}

export type AuthErrorCode =
  | 'invalid_credentials'
  /** Senha certa, email ainda não confirmado (ver `IAuthProvider.signIn`). */
  | 'email_unverified'
  | 'unauthenticated'
  | 'provider_error';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: AuthErrorCode = 'invalid_credentials',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
