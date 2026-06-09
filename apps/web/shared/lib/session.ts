/** Forma mínima da sessão consumida pelo shell. O contrato real (member +
 *  workspace + role) é fixado pelos slots de auth backend (F0-S05/S06). */
export interface SessionUser {
  readonly memberId: string;
  readonly workspaceId: string;
}

export const SESSION_COOKIE = 'hm_session';
