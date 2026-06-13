/**
 * Rotação de `platform_secrets` (F25-S04).
 *
 * Cifra/decifra com a MESMA cifra AES-256-GCM de `@hm/db` (idêntica a
 * channel_secrets). NUNCA retorna/loga o valor decifrado. A rotação faz upsert do
 * `value_enc` e incrementa `key_version`; a auditoria é responsabilidade do caller
 * (a rota) que tem o actor da sessão.
 *
 * Camada de plataforma (sem workspace_id) → roda sob `getDb()` (owner).
 */
import { sql } from 'drizzle-orm';
import { encryptSecret, getDb, schema } from '@hm/db';

const { platformSecrets } = schema;

/** Keys conhecidas (DATA_MODEL §7.12 / INFRASTRUCTURE §10). Set fechado: key
 *  desconhecida → 400 (evita poluir a tabela com chaves arbitrárias). */
export const KNOWN_SECRET_KEYS = [
  'openrouter_api_key',
  'openai_api_key',
  'meta_app_id',
  'meta_app_secret',
  'meta_webhook_verify_token',
] as const;

export type KnownSecretKey = (typeof KNOWN_SECRET_KEYS)[number];

export function isKnownSecretKey(key: string): key is KnownSecretKey {
  return (KNOWN_SECRET_KEYS as readonly string[]).includes(key);
}

export interface SecretMeta {
  readonly key: string;
  readonly keyVersion: number;
  readonly updatedAt: Date | null;
  readonly isSet: boolean;
}

/**
 * Lista metadados de todas as keys conhecidas — SEM valor em claro. Keys ainda não
 * configuradas aparecem como `isSet: false` (key_version 0) para guiar o painel.
 */
export async function listSecretMeta(db = getDb()): Promise<SecretMeta[]> {
  const rows = await db
    .select({
      key: platformSecrets.key,
      keyVersion: platformSecrets.keyVersion,
      updatedAt: platformSecrets.updatedAt,
    })
    .from(platformSecrets);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return KNOWN_SECRET_KEYS.map((key) => {
    const row = byKey.get(key);
    return row
      ? { key, keyVersion: row.keyVersion, updatedAt: row.updatedAt, isSet: true }
      : { key, keyVersion: 0, updatedAt: null, isSet: false };
  });
}

/**
 * Rotaciona (set) o valor de uma key: cifra o novo valor e faz upsert,
 * incrementando `key_version`. Retorna SÓ metadados (nunca o valor).
 */
export async function rotateSecret(
  key: KnownSecretKey,
  value: string,
  db = getDb(),
): Promise<SecretMeta> {
  const valueEnc = encryptSecret(value);
  const now = new Date();
  const [row] = await db
    .insert(platformSecrets)
    .values({ key, valueEnc, keyVersion: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: platformSecrets.key,
      set: {
        valueEnc,
        keyVersion: sql`${platformSecrets.keyVersion} + 1`,
        updatedAt: now,
      },
    })
    .returning({ keyVersion: platformSecrets.keyVersion, updatedAt: platformSecrets.updatedAt });
  return { key, keyVersion: row!.keyVersion, updatedAt: row!.updatedAt, isSet: true };
}
