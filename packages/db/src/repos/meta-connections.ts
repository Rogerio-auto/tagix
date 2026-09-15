/**
 * Repositório de conexões Meta (F69-S02).
 *
 * Tudo que é do workspace roda sob a transação recebida, ou seja, sob RLS. As duas
 * exceções — `forgetMetaUser` e `revokeMetaUser` — atendem aos callbacks da Meta,
 * que chegam sem workspace, e passam pelas funções `SECURITY DEFINER` da migration
 * 0079: elas fazem uma única coisa cada e não expõem leitura entre tenants.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import {
  metaConnections,
  type MetaConnection,
  type MetaConnectionAssets,
} from '../schema/meta_connections';

/** A conexão como pode sair do banco para a rota: **sem o token**. */
export type MetaConnectionPublic = Omit<MetaConnection, 'accessTokenEnc' | 'keyVersion'>;

const COLUNAS_PUBLICAS = {
  id: metaConnections.id,
  workspaceId: metaConnections.workspaceId,
  metaUserId: metaConnections.metaUserId,
  metaUserName: metaConnections.metaUserName,
  tokenExpiresAt: metaConnections.tokenExpiresAt,
  useCases: metaConnections.useCases,
  grantedPermissions: metaConnections.grantedPermissions,
  declinedPermissions: metaConnections.declinedPermissions,
  assets: metaConnections.assets,
  status: metaConnections.status,
  connectedBy: metaConnections.connectedBy,
  lastCheckedAt: metaConnections.lastCheckedAt,
  createdAt: metaConnections.createdAt,
  updatedAt: metaConnections.updatedAt,
} as const;

export interface UpsertMetaConnectionInput {
  readonly workspaceId: string;
  readonly metaUserId: string;
  readonly metaUserName: string | null;
  /** Já cifrado por quem chama. */
  readonly accessTokenEnc: string;
  readonly keyVersion: number;
  readonly tokenExpiresAt: Date | null;
  readonly useCases: string[];
  readonly grantedPermissions: string[];
  readonly declinedPermissions: string[];
  readonly assets: MetaConnectionAssets;
  readonly connectedBy: string | null;
  readonly now: Date;
}

/**
 * Cria ou atualiza a conexão desta pessoa neste workspace.
 *
 * Reconectar **acumula** casos de uso: quem já tinha leads e agora conecta
 * anúncios continua com leads. Perder um caso de uso ao reconectar para outro
 * seria o tipo de surpresa que só aparece quando os leads param.
 */
async function upsert(tx: DbTx, input: UpsertMetaConnectionInput): Promise<MetaConnectionPublic> {
  const [linha] = await tx
    .insert(metaConnections)
    .values({
      workspaceId: input.workspaceId,
      metaUserId: input.metaUserId,
      metaUserName: input.metaUserName,
      accessTokenEnc: input.accessTokenEnc,
      keyVersion: input.keyVersion,
      tokenExpiresAt: input.tokenExpiresAt,
      useCases: input.useCases,
      grantedPermissions: input.grantedPermissions,
      declinedPermissions: input.declinedPermissions,
      assets: input.assets,
      status: 'active',
      connectedBy: input.connectedBy,
      lastCheckedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [metaConnections.workspaceId, metaConnections.metaUserId],
      set: {
        metaUserName: input.metaUserName,
        accessTokenEnc: input.accessTokenEnc,
        keyVersion: input.keyVersion,
        tokenExpiresAt: input.tokenExpiresAt,
        // União sem repetição dos casos de uso antigos e novos.
        useCases: sql`(select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements_text(${metaConnections.useCases} || ${JSON.stringify(input.useCases)}::jsonb) as v)`,
        grantedPermissions: input.grantedPermissions,
        declinedPermissions: input.declinedPermissions,
        assets: input.assets,
        status: 'active',
        connectedBy: input.connectedBy,
        lastCheckedAt: input.now,
        updatedAt: input.now,
      },
    })
    .returning(COLUNAS_PUBLICAS);
  if (linha === undefined) throw new Error('meta_connections: upsert não devolveu linha.');
  return linha;
}

async function listForWorkspace(tx: DbTx, workspaceId: string): Promise<MetaConnectionPublic[]> {
  return tx
    .select(COLUNAS_PUBLICAS)
    .from(metaConnections)
    .where(eq(metaConnections.workspaceId, workspaceId));
}

/** Uma conexão com o token cifrado — só para quem vai usá-lo no servidor. */
async function getWithToken(
  tx: DbTx,
  workspaceId: string,
  id: string,
): Promise<MetaConnection | null> {
  const [linha] = await tx
    .select()
    .from(metaConnections)
    .where(and(eq(metaConnections.workspaceId, workspaceId), eq(metaConnections.id, id)))
    .limit(1);
  return linha ?? null;
}

async function updatePermissionsAndAssets(
  tx: DbTx,
  input: {
    workspaceId: string;
    id: string;
    grantedPermissions: string[];
    declinedPermissions: string[];
    assets: MetaConnectionAssets;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(metaConnections)
    .set({
      grantedPermissions: input.grantedPermissions,
      declinedPermissions: input.declinedPermissions,
      assets: input.assets,
      lastCheckedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(eq(metaConnections.workspaceId, input.workspaceId), eq(metaConnections.id, input.id)),
    );
}

async function remove(tx: DbTx, workspaceId: string, id: string): Promise<boolean> {
  const apagadas = await tx
    .delete(metaConnections)
    .where(and(eq(metaConnections.workspaceId, workspaceId), eq(metaConnections.id, id)))
    .returning({ id: metaConnections.id });
  return apagadas.length > 0;
}

/** Callback de exclusão (F69-S01): apaga as conexões desta pessoa em todos os workspaces. */
async function forgetMetaUser(metaUserId: string): Promise<number> {
  const linhas = await getDb().execute<{ n: number }>(
    sql`select public.meta_forget_user(${metaUserId}) as n`,
  );
  return Number(linhas[0]?.n ?? 0);
}

/** Callback de desautorização (F69-S01): revoga e apaga os tokens desta pessoa. */
async function revokeMetaUser(metaUserId: string): Promise<number> {
  const linhas = await getDb().execute<{ n: number }>(
    sql`select public.meta_revoke_user(${metaUserId}) as n`,
  );
  return Number(linhas[0]?.n ?? 0);
}

export const metaConnectionsRepo = {
  upsert,
  listForWorkspace,
  getWithToken,
  updatePermissionsAndAssets,
  remove,
  forgetMetaUser,
  revokeMetaUser,
} as const;
