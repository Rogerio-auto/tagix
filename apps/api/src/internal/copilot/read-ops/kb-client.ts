/**
 * Cliente HTTP mínimo da busca na base de conhecimento do runtime (F73-S07; COPILOTO.md §5.4).
 *
 * `POST {AGENT_RUNTIME_URL}/kb/search`, Bearer `AGENT_RUNTIME_TOKEN` (o mesmo bearer de serviço
 * das demais chamadas Node → runtime). Quem chama é o NODE, depois de decidir workspace e
 * permissão: o `workspace_id` vem SEMPRE do grant (principal), nunca do modelo.
 *
 * Contrato (`apps/agent-runtime/app/routes/kb_search.py`):
 *   corpo    `{ workspace_id: uuid, query: 1..500, limit: 1..8 }` (fechado);
 *   resposta `{ results: { document_id, title, snippet ≤ 600, score }[] }`.
 *
 * Erro seguro: nunca lança. Falta de configuração, timeout (5 s), status ≠ 2xx, corpo
 * inválido ou rede caída viram `{ ok: false, reason }`, e o motivo só vai ao log (sem URL,
 * sem corpo, sem token). Quem chama devolve ao modelo uma mensagem fixa.
 */
import { z } from 'zod';

export const KB_SEARCH_TIMEOUT_MS = 5_000;
/** Teto do runtime para a consulta e o número de resultados. */
export const KB_QUERY_MAX = 500;
export const KB_LIMIT_MAX = 8;

const KbSearchResultSchema = z.object({
  document_id: z.string().min(1).max(128),
  title: z.string().max(2_000),
  snippet: z.string().max(600),
  score: z.number().finite(),
});

const KbSearchResponseSchema = z.object({
  results: z.array(KbSearchResultSchema).max(KB_LIMIT_MAX),
});

export type KbSearchResult = z.infer<typeof KbSearchResultSchema>;

export type KbSearchFailure =
  | 'not_configured'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'network_error';

export type KbSearchOutcome =
  | { readonly ok: true; readonly results: readonly KbSearchResult[] }
  | { readonly ok: false; readonly reason: KbSearchFailure; readonly status?: number };

export interface KbClientConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  /** Injeção para teste; padrão: `fetch` global. */
  readonly fetchImpl?: typeof fetch;
}

/** Config do ambiente (a mesma do playground e do turno). `null` sem URL ou token. */
export function kbClientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KbClientConfig | null {
  const baseUrl = env['AGENT_RUNTIME_URL'];
  const token = env['AGENT_RUNTIME_TOKEN'];
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export interface KbSearchInput {
  readonly workspaceId: string;
  readonly query: string;
  readonly limit: number;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export async function searchKb(
  config: KbClientConfig | null,
  input: KbSearchInput,
): Promise<KbSearchOutcome> {
  if (!config) return { ok: false, reason: 'not_configured' };
  const url = `${config.baseUrl.replace(/\/+$/, '')}/kb/search`;
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? KB_SEARCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        query: input.query.slice(0, KB_QUERY_MAX),
        limit: Math.min(Math.max(Math.trunc(input.limit), 1), KB_LIMIT_MAX),
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) {
      // Drena o corpo para liberar o socket; o conteúdo nunca é usado.
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'http_error', status: res.status };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, reason: isAbort(err) ? 'timeout' : 'invalid_response' };
    }
    const parsed = KbSearchResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'invalid_response' };
    return { ok: true, results: parsed.data.results };
  } catch (err) {
    return { ok: false, reason: isAbort(err) ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
