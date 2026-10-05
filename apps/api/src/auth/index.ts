export { getAuthProvider } from './provider';
export { AuthProviderUnavailableError } from './supabase-provider';
export { closeLoginCaptcha } from './login-captcha';
export { createAuthRouter } from './routes';
export {
  SESSION_COOKIE,
  WORKSPACE_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  setActiveWorkspaceCookie,
  clearActiveWorkspaceCookie,
  readToken,
  readCookieFromHeader,
  readPreferredWorkspace,
  preferredWorkspaceFromHeader,
  isUuid,
  resolveSession,
  resolveSessionStatus,
  publicMember,
} from './session';
export type { SessionContext, SessionResolution, Member, Workspace } from './session';
