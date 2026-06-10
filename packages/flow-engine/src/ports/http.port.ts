/** HTTP port real: fetch nativo com timeout (FLOW_BUILDER.md secao 6.1/12). */
import type { FlowHttpPort } from '../deps';
import type { FlowHttpRequest, FlowHttpResponse } from '../types';

const DEFAULT_TIMEOUT_MS = 30_000;

export const flowHttpPort: FlowHttpPort = {
  async request(input: FlowHttpRequest): Promise<FlowHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: {
          ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...input.headers,
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, ok: res.ok, body, headers };
    } finally {
      clearTimeout(timeout);
    }
  },
};
