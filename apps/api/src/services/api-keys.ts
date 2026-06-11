/**
 * Serviço de API keys (F9-S02): geração/hashing de tokens e lookup para o gate da
 * API pública. O CRUD de gestão (create show-once / list / revoke) é da F9-S04 e
 * reusa estes helpers — nada de regra de token duplicada lá.
 *
 * Modelo de segurança:
 * - O token claro (`hm_<random>`) é mostrado UMA vez, na criação. Persistimos só o
 *   SHA-256 (`key_hash`, UNIQUE) e um prefixo de display (`key_prefix`).
 * - O lookup é por hash do token apresentado — nunca por igualdade do token claro.
 * - A consulta roda como owner (`getDb()`, bypassa RLS): o workspace ainda não é
 *   conhecido no momento da autenticação; o isolamento passa a valer depois, quando
 *   o handler usa `withWorkspace(apiAuth.workspaceId, ...)`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';

const { apiKeys } = schema;

/** Prefixo do token claro — identifica a origem e habilita scan/rotação. */
export const API_KEY_TOKEN_PREFIX = 'hm_';
/** Quantos chars do token (incl. prefixo) guardamos como display em `key_prefix`. */
const KEY_PREFIX_DISPLAY_LEN = 12;
/** Bytes de entropia do segredo (256 bits) → base64url. */
const TOKEN_ENTROPY_BYTES = 32;

export interface GeneratedApiKey {
  /** Token claro `hm_...`. Só existe aqui e na resposta da criação — nunca persiste. */
  readonly token: string;
  /** SHA-256 hex do token — o que vai em `api_keys.key_hash`. */
  readonly keyHash: string;
  /** Primeiros chars do token, para exibir na listagem (`api_keys.key_prefix`). */
  readonly keyPrefix: string;
}

/** SHA-256 hex de um token claro. Determinístico → usado no lookup e na criação. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Gera um novo token `hm_...` com seu hash e prefixo de display. */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url');
  const token = `${API_KEY_TOKEN_PREFIX}${secret}`;
  return {
    token,
    keyHash: hashToken(token),
    keyPrefix: token.slice(0, KEY_PREFIX_DISPLAY_LEN),
  };
}

/** Extrai o token de um header `Authorization: Bearer hm_...`. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token || !token.startsWith(API_KEY_TOKEN_PREFIX)) return null;
  return token;
}

/** Contexto autenticado por API key, injetado em `req.apiAuth`. */
export interface ApiKeyAuth {
  readonly keyId: string;
  readonly workspaceId: string;
  readonly scopes: readonly string[];
  readonly rateLimitPerMinute: number;
}

/**
 * Resolve um token claro para o contexto da chave, SE estiver ativa, não revogada e
 * não expirada. Retorna `null` em qualquer falha (token desconhecido/inativo/expirado).
 * Roda como owner — bypassa RLS de propósito (workspace ainda desconhecido).
 */
export async function lookupApiKey(token: string): Promise<ApiKeyAuth | null> {
  const candidate = hashToken(token);
  const db = getDb();
  const [row] = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      keyHash: apiKeys.keyHash,
      scopes: apiKeys.scopes,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, candidate),
        eq(apiKeys.isActive, true),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > now()`),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Defesa em profundidade: confirma o hash em tempo constante (o índice já filtrou,
  // mas evita qualquer brecha teórica de comparação não-constante a montante).
  const expected = Buffer.from(row.keyHash, 'utf8');
  const got = Buffer.from(candidate, 'utf8');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  return {
    keyId: row.id,
    workspaceId: row.workspaceId,
    scopes: row.scopes ?? [],
    rateLimitPerMinute: row.rateLimitPerMinute,
  };
}

/**
 * Marca `last_used_at = now()` para a chave. Best-effort (não bloqueia a request) —
 * roda como owner. Falha de escrita não deve derrubar uma request autenticada válida.
 */
export async function touchApiKeyLastUsed(keyId: string): Promise<void> {
  try {
    await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
  } catch {
    // best-effort: telemetria de uso não é caminho crítico.
  }
}
