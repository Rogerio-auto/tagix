/** Contrato de `/api/meta/*` (F69-S02). Espelha `apps/api/src/routes/meta/connections.ts`. */

export type MetaUseCaseId =
  | 'leads'
  | 'ads_read'
  | 'ads_manage'
  | 'instagram'
  | 'instagram_publish'
  | 'ads_mcp';

export interface MetaUseCaseOption {
  id: MetaUseCaseId;
  label: string;
  permissions: string[];
}

export type MetaConnectionHealth = 'ok' | 'expiring' | 'missing_permissions' | 'expired' | 'revoked';

export interface MetaConnectionView {
  id: string;
  metaUserName: string | null;
  status: 'active' | 'revoked';
  health: MetaConnectionHealth;
  useCases: Array<{ id: MetaUseCaseId; label: string; missing: string[] }>;
  assets: {
    pages: Array<{ id: string; name: string | null; instagram: { id: string; username: string | null } | null }>;
    adAccounts: Array<{ id: string; name: string | null; currency: string | null }>;
  };
  tokenExpiresAt: string | null;
  lastCheckedAt: string | null;
}
