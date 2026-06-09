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

export interface IAuthProvider {
  readonly kind: 'supabase' | 'mock';
  signIn(credentials: AuthCredentials): Promise<AuthSession>;
  verifyToken(token: string): Promise<AuthIdentity | null>;
  signOut(token: string): Promise<void>;
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
