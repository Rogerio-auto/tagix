/**
 * Handler `http_request` (FLOW_BUILDER.md secao 4.1/6.1/12). Chama HTTP externo via
 * ctx.httpRequest (timeout duro 30s no port). Retry exponencial configuravel por
 * `node.data.retryPolicy`. Guarda a resposta em `variables.webhook_response` e roteia por
 * `success`/`error` (2xx = success).
 */
import { z } from 'zod';
import { interpolate } from '../utils/interpolate';
import type { FlowHandler } from '../types';

const retryPolicySchema = z.object({
  maxAttempts: z.number().min(1).max(10).optional(),
  initialDelayMs: z.number().min(0).optional(),
  maxDelayMs: z.number().min(0).optional(),
});

const httpRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().min(0).max(30_000).optional(),
  retryPolicy: retryPolicySchema.optional(),
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const httpRequestHandler: FlowHandler<z.infer<typeof httpRequestSchema>> = {
  schema: httpRequestSchema,
  async execute(node, ctx) {
    const data = httpRequestSchema.parse(node.data);
    const maxAttempts = data.retryPolicy?.maxAttempts ?? 3;
    const initialDelay = data.retryPolicy?.initialDelayMs ?? 1000;
    const maxDelay = data.retryPolicy?.maxDelayMs ?? 30_000;
    const url = interpolate(data.url, ctx.variables);

    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await ctx.httpRequest({
          method: data.method,
          url,
          headers: data.headers,
          body: data.body,
          timeoutMs: data.timeoutMs ?? 30_000,
        });
        const webhook_response = {
          status: res.status,
          ok: res.ok,
          body: res.body,
          headers: res.headers,
        };
        if (res.ok) {
          return { status: 'SUCCESS', edgeHandle: 'success', variables: { webhook_response } };
        }
        lastError = `HTTP ${res.status}`;
        // 4xx nao retenta (erro do cliente); 5xx retenta.
        if (res.status < 500) {
          return {
            status: 'SUCCESS',
            edgeHandle: 'error',
            variables: { webhook_response, webhook_error: lastError },
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

    ctx.log('warn', `http_request falhou apos ${maxAttempts} tentativas`, { url, lastError });
    return {
      status: 'SUCCESS',
      edgeHandle: 'error',
      variables: { webhook_error: lastError },
    };
  },
};
