/**
 * Handler `http_request` (FLOW_BUILDER.md secao 4.1/6.1/12). Chama HTTP externo via
 * ctx.httpRequest (allowlist/SSRF + timeout duro resolvidos no port). Retry exponencial
 * configuravel por `node.data.retryPolicy`. Guarda a resposta em `variables.webhook_response`,
 * aplica o mapeamento JSONPath -> variavel custom e roteia por `success`/`error` (2xx = success).
 *
 * Seguranca: a allowlist/timeout anti-SSRF vivem no port (`ctx.httpRequest`) — este handler
 * apenas o consome. Headers/body sao interpolados mas NUNCA logados (podem conter segredos).
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const retryPolicySchema = z.object({
  maxAttempts: z.number().min(1).max(10).optional(),
  initialDelayMs: z.number().min(0).optional(),
  maxDelayMs: z.number().min(0).optional(),
});

/** Cabecalho como par estruturado (UI) — tolera tambem o legado `Record<string,string>`. */
const headerEntrySchema = z.object({ key: z.string(), value: z.string() });

/** Mapeamento de um JSONPath (relativo ao corpo da resposta) para uma variavel custom. */
const responseMappingEntrySchema = z.object({
  /** JSONPath relativo ao corpo da resposta, ex.: `$.data.id`. */
  path: z.string(),
  /** Nome da variavel destino (usavel a jusante como `{{nome}}`). */
  variable: z.string(),
});

const httpRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  // String livre (nao `.url()`): a URL pode conter variaveis `{{...}}` e so e
  // resolvida apos interpolacao. A validacao real de destino fica no port (SSRF).
  url: z.string().min(1),
  headers: z.union([z.array(headerEntrySchema), z.record(z.string())]).optional(),
  /** Modo do corpo: nenhum, JSON (parseado) ou texto cru. */
  bodyMode: z.enum(['none', 'json', 'raw']).optional(),
  /** Corpo cru (string com `{{...}}`) ou objeto legado. */
  body: z.unknown().optional(),
  timeoutMs: z.number().min(0).max(30_000).optional(),
  retryPolicy: retryPolicySchema.optional(),
  responseMapping: z.array(responseMappingEntrySchema).optional(),
});

type HttpRequestData = z.infer<typeof httpRequestSchema>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Normaliza headers (array estruturado ou record legado) para `Record<string,string>`, interpolando. */
function buildHeaders(
  headers: HttpRequestData['headers'],
  vars: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Array.isArray(headers)
    ? headers.map((h) => [h.key, h.value] as const)
    : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = interpolate(rawKey, vars).trim();
    if (!key) continue;
    out[key] = interpolate(rawValue, vars);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Resolve o corpo conforme o modo, interpolando variaveis. JSON invalido cai para texto. */
function buildBody(data: HttpRequestData, vars: Record<string, unknown>): unknown {
  const mode: NonNullable<HttpRequestData['bodyMode']> =
    data.bodyMode ?? (data.body == null ? 'none' : 'raw');
  if (mode === 'none') return undefined;
  const raw =
    typeof data.body === 'string'
      ? data.body
      : data.body == null
        ? ''
        : JSON.stringify(data.body);
  const interpolated = interpolate(raw, vars);
  if (mode === 'json') {
    try {
      return JSON.parse(interpolated) as unknown;
    } catch {
      // JSON malformado: envia como texto cru (o servidor decide o que fazer).
      return interpolated;
    }
  }
  return interpolated;
}

const PATH_SEGMENT =
  /\.([\w$-]+)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\d+)\s*\]/g;

/** Avalia um JSONPath simples (`$.a.b[0]['c']`) contra `root`. Retorna `undefined` se nao resolver. */
function evalJsonPath(root: unknown, path: string): unknown {
  const trimmed = path.trim();
  const body = trimmed.startsWith('$') ? trimmed.slice(1) : trimmed;
  if (body.trim() === '') return root;
  let current: unknown = root;
  PATH_SEGMENT.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_SEGMENT.exec(body)) !== null) {
    // Garante que nao ha "lixo" entre segmentos (path malformado).
    if (match.index !== lastIndex) return undefined;
    lastIndex = PATH_SEGMENT.lastIndex;
    const key = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (key === undefined) return undefined;
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(key);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  // Sobrou texto nao casado -> path invalido.
  if (lastIndex !== body.length) return undefined;
  return current;
}

/** Aplica os mapeamentos JSONPath -> variavel custom contra o corpo da resposta. */
function applyResponseMapping(
  mapping: HttpRequestData['responseMapping'],
  responseBody: unknown,
): Record<string, unknown> {
  if (!mapping || mapping.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const entry of mapping) {
    const name = entry.variable.trim();
    if (!name) continue;
    const value = evalJsonPath(responseBody, entry.path);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export const httpRequestHandler: FlowHandler<HttpRequestData> = {
  schema: httpRequestSchema,
  async execute(node, ctx) {
    const data = httpRequestSchema.parse(node.data);
    const maxAttempts = data.retryPolicy?.maxAttempts ?? 3;
    const initialDelay = data.retryPolicy?.initialDelayMs ?? 1000;
    const maxDelay = data.retryPolicy?.maxDelayMs ?? 30_000;
    const url = interpolate(data.url, ctx.variables);
    const headers = buildHeaders(data.headers, ctx.variables);
    const body = buildBody(data, ctx.variables);

    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await ctx.httpRequest({
          method: data.method,
          url,
          headers,
          body,
          timeoutMs: data.timeoutMs ?? 30_000,
        });
        const webhook_response = {
          status: res.status,
          ok: res.ok,
          body: res.body,
          headers: res.headers,
        };
        const mapped = applyResponseMapping(data.responseMapping, res.body);
        if (res.ok) {
          return {
            status: 'SUCCESS',
            edgeHandle: 'success',
            variables: { webhook_response, ...mapped },
          };
        }
        lastError = `HTTP ${res.status}`;
        // 4xx nao retenta (erro do cliente); 5xx retenta.
        if (res.status < 500) {
          return {
            status: 'SUCCESS',
            edgeHandle: 'error',
            variables: { webhook_response, webhook_error: lastError, ...mapped },
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(initialDelay * 2 ** (attempt - 1), maxDelay);
        await sleep(delay);
      }
    }

    // Nao loga headers/body (podem conter segredos): apenas url e mensagem de erro.
    ctx.log('warn', `http_request falhou apos ${maxAttempts} tentativas`, { url, lastError });
    return {
      status: 'SUCCESS',
      edgeHandle: 'error',
      variables: { webhook_error: lastError },
    };
  },
};
