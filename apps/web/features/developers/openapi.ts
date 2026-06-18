'use client';

/**
 * Carrega e modela o documento OpenAPI 3.1 da Leadium API (F38-S13). A spec e
 * publica em /api/v1/openapi.json (nao exige API key) e ja inclui os endpoints
 * novos do S12. Modelamos so o subconjunto que o portal renderiza — sem `any`.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string }>;
}

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, OpenApiPathItem>;
}

export interface Endpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  scope: string | null;
  hasBody: boolean;
}

export interface ResourceGroup {
  resource: string;
  endpoints: Endpoint[];
}

/** Extrai o scope do texto da descricao (padrao do backend: "Requer o scope `x`."). */
function extractScope(description: string): string | null {
  const m = /scope\s+`([^`]+)`/.exec(description);
  return m ? (m[1] ?? null) : null;
}

/** Agrupa por recurso = 1o segmento depois de /api/v1/. */
function resourceOf(path: string): string {
  const rest = path.replace(/^\/api\/v1\//, '');
  const seg = rest.split('/')[0] ?? 'geral';
  return seg.replace(/_/g, ' ');
}

export function groupEndpoints(doc: OpenApiDoc): ResourceGroup[] {
  const groups = new Map<string, Endpoint[]>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const description = op.description ?? '';
      const endpoint: Endpoint = {
        method,
        path,
        summary: op.summary ?? '',
        description,
        scope: extractScope(description),
        hasBody: op.requestBody !== undefined,
      };
      const key = resourceOf(path);
      const arr = groups.get(key) ?? [];
      arr.push(endpoint);
      groups.set(key, arr);
    }
  }
  return [...groups.entries()]
    .map(([resource, endpoints]) => ({ resource, endpoints }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

export function useOpenApi() {
  return useQuery({
    queryKey: ['developers', 'openapi'],
    queryFn: () => api.get<OpenApiDoc>('/api/v1/openapi.json'),
    staleTime: 5 * 60 * 1000,
  });
}
