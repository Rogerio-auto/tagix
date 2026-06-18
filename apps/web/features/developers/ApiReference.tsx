'use client';

/**
 * Referencia da Leadium API (F38-S13) renderizada do OpenAPI live — agrupada por
 * recurso, com metodo/path/summary/scope. Inclui automaticamente os endpoints
 * novos do S12 (a fonte e a spec, nao uma lista hardcoded). DS v2.
 */
import type { Endpoint, HttpMethod } from './openapi';
import { groupEndpoints, useOpenApi } from './openapi';

const METHOD_CLS: Record<HttpMethod, string> = {
  get: 'bg-brand/15 text-brand',
  post: 'bg-success/15 text-success',
  put: 'bg-warn/15 text-warn',
  patch: 'bg-warn/15 text-warn',
  delete: 'bg-danger/15 text-danger',
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 font-price text-[11px] font-semibold uppercase ' +
        METHOD_CLS[method]
      }
    >
      {method}
    </span>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-border-2 px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-2">
        <MethodBadge method={endpoint.method} />
        <code className="font-price text-sm text-text">{endpoint.path}</code>
        {endpoint.scope && (
          <span className="ml-auto rounded-pill bg-surface-3 px-2 py-0.5 font-price text-[11px] text-text-low">
            {endpoint.scope}
          </span>
        )}
      </div>
      {endpoint.summary && <p className="font-body text-sm text-text-mid">{endpoint.summary}</p>}
    </li>
  );
}

export function ApiReference() {
  const { data, isLoading, isError, refetch } = useOpenApi();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 px-5 py-6 text-center">
        <p className="text-sm text-danger">Nao foi possivel carregar a referencia da API.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 font-head text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:shadow-glow-md"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const groups = groupEndpoints(data);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.resource} aria-label={g.resource}>
          <h3 className="mb-3 font-head text-lg font-semibold capitalize text-text">{g.resource}</h3>
          <ul className="overflow-hidden rounded-lg border border-border-2 bg-surface">
            {g.endpoints.map((e) => (
              <EndpointRow key={`${e.method}:${e.path}`} endpoint={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
