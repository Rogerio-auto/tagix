/**
 * Segredos de plataforma carregados em memória no boot da API.
 * Fonte: tabela `platform_secrets` (cifrada) + fallback nas env vars (MVP, até
 * o painel super-admin popular a tabela).
 */
import { decryptSecret, getDb, schema } from '@hm/db';

const ENV_FALLBACK: Record<string, string> = {
  meta_app_secret: 'META_APP_SECRET',
  meta_app_id: 'META_APP_ID',
  meta_webhook_verify_token: 'META_WEBHOOK_VERIFY_TOKEN',
};

let cache: Map<string, string> | null = null;

export async function loadPlatformSecrets(): Promise<void> {
  const map = new Map<string, string>();
  try {
    const rows = await getDb().select().from(schema.platformSecrets);
    for (const row of rows) {
      try {
        map.set(row.key, decryptSecret(row.valueEnc, row.keyVersion));
      } catch {
        // secret indecifrável (key rotacionada?) — ignora, não derruba o boot
      }
    }
  } catch {
    // tabela ausente em ambiente mínimo — segue só com o fallback de env
  }
  for (const [key, envName] of Object.entries(ENV_FALLBACK)) {
    if (!map.has(key)) {
      const value = process.env[envName];
      if (value) map.set(key, value);
    }
  }
  cache = map;
}

export const platformSecrets = {
  get(key: string): string | undefined {
    return cache?.get(key);
  },
  require(key: string): string {
    const value = cache?.get(key);
    if (value === undefined) throw new Error(`Platform secret obrigatório ausente: ${key}`);
    return value;
  },
};
