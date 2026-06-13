/**
 * Sync do catálogo global de modelos com a OpenRouter (F25-S02).
 *
 * Puxa `GET https://openrouter.ai/api/v1/models`, mapeia para as colunas de
 * `llm_models_whitelist` e faz upsert idempotente por `slug` (re-sync não duplica;
 * `synced_at` atualizado). A key OpenRouter vem cifrada de `platform_secrets`
 * (`openrouter_api_key`) e é decifrada só em memória — NUNCA logada/retornada.
 *
 * Camada de plataforma: roda sob `getDb()` (owner, sem RLS de tenant) — a tabela é
 * GLOBAL (sem workspace_id). O guard `requirePlatformAdmin` é a fronteira.
 */
import { sql } from 'drizzle-orm';
import { decryptSecret, getDb, schema } from '@hm/db';

const { llmModelsWhitelist, platformSecrets } = schema;

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const OPENROUTER_SECRET_KEY = 'openrouter_api_key';

/** Shape parcial do item de `/models` da OpenRouter (campos que consumimos). */
interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; modality?: string };
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

export interface SyncResult {
  readonly upserted: number;
  readonly total: number;
}

/** Lê a key OpenRouter cifrada de `platform_secrets` e decifra. */
export async function readOpenRouterKey(db = getDb()): Promise<string | null> {
  const [row] = await db
    .select({ valueEnc: platformSecrets.valueEnc, keyVersion: platformSecrets.keyVersion })
    .from(platformSecrets)
    .where(sql`${platformSecrets.key} = ${OPENROUTER_SECRET_KEY}`)
    .limit(1);
  if (!row) return null;
  return decryptSecret(row.valueEnc, row.keyVersion);
}

/** Deriva `upstream_provider` do slug OpenRouter ('openai/gpt-4o' → 'openai'). */
function providerOf(slug: string): string {
  const idx = slug.indexOf('/');
  return idx === -1 ? slug : slug.slice(0, idx);
}

/** USD por 1M tokens a partir do pricing por-token da OpenRouter (string decimal). */
function per1m(perToken: string | undefined): string | null {
  if (perToken === undefined) return null;
  const n = Number(perToken);
  if (!Number.isFinite(n)) return null;
  return (n * 1_000_000).toFixed(6);
}

function supportsVision(m: OpenRouterModel): boolean {
  const mods = m.architecture?.input_modalities;
  if (Array.isArray(mods)) return mods.includes('image');
  return (m.architecture?.modality ?? '').includes('image');
}

function supportsTools(m: OpenRouterModel): boolean {
  return (m.supported_parameters ?? []).includes('tools');
}

/**
 * Mapeia um item OpenRouter para a linha de upsert. Exportado para teste unitário
 * do mapeamento sem rede.
 */
export function mapModelRow(m: OpenRouterModel) {
  return {
    slug: m.id,
    displayName: m.name ?? m.id,
    upstreamProvider: providerOf(m.id),
    contextLength: typeof m.context_length === 'number' ? m.context_length : null,
    supportsTools: supportsTools(m),
    supportsVision: supportsVision(m),
    pricingPromptPer1m: per1m(m.pricing?.prompt),
    pricingCompletionPer1m: per1m(m.pricing?.completion),
  };
}

/** Permite injetar um fetcher nos testes (sem rede). */
export type ModelsFetcher = (apiKey: string) => Promise<OpenRouterModel[]>;

const defaultFetcher: ModelsFetcher = async (apiKey) => {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter /models respondeu ${res.status}`);
  }
  const body = (await res.json()) as { data?: OpenRouterModel[] };
  return body.data ?? [];
};

/**
 * Sincroniza a whitelist com a OpenRouter. Upsert por `slug` (idempotente):
 * atualiza pricing/context/supports e `synced_at`; NÃO mexe em `is_active`,
 * `default_plan_keys` nem `notes` (curadoria do super-admin é preservada).
 */
export async function syncOpenRouterModels(
  opts: { db?: ReturnType<typeof getDb>; fetcher?: ModelsFetcher } = {},
): Promise<SyncResult> {
  const db = opts.db ?? getDb();
  const fetcher = opts.fetcher ?? defaultFetcher;

  const apiKey = await readOpenRouterKey(db);
  if (!apiKey) {
    throw new Error('OPENROUTER_KEY_MISSING');
  }

  const models = await fetcher(apiKey);
  let upserted = 0;
  const now = new Date();

  for (const m of models) {
    if (!m.id) continue;
    const row = mapModelRow(m);
    await db
      .insert(llmModelsWhitelist)
      .values({ ...row, syncedAt: now })
      .onConflictDoUpdate({
        target: llmModelsWhitelist.slug,
        set: {
          displayName: row.displayName,
          upstreamProvider: row.upstreamProvider,
          contextLength: row.contextLength,
          supportsTools: row.supportsTools,
          supportsVision: row.supportsVision,
          pricingPromptPer1m: row.pricingPromptPer1m,
          pricingCompletionPer1m: row.pricingCompletionPer1m,
          syncedAt: now,
          updatedAt: now,
        },
      });
    upserted += 1;
  }

  return { upserted, total: models.length };
}
