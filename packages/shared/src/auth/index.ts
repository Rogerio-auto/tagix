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

export interface IAuthProvider {
  readonly kind: 'supabase' | 'mock';
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
}

export type AuthErrorCode = 'invalid_credentials' | 'unauthenticated' | 'provider_error';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: AuthErrorCode = 'invalid_credentials',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
