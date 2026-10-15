'use client';

/**
 * Referencia rica da Leadium API (F38-S13 + F41-S01) renderizada do OpenAPI live,
 * agrupada por recurso. Cada endpoint expande para um painel com: parametros
 * (path/query), request body (campos/tipos/obrigatorios), schema de response e
 * um exemplo de requisicao gerado do schema (curl/JS/Python via buildExample).
 * A fonte e sempre a spec /api/v1/openapi.json, nunca uma lista hardcoded. DS v2.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, Button, type BadgeTone } from '@hm/ui';
import { CodeBlock } from './CodeBlock';
import type { Endpoint, HttpMethod, ParamField, ResolvedSchema, SchemaField } from './openapi';
import { groupEndpoints, useOpenApi } from './openapi';
import type { SnippetLang } from './snippets';
import { buildExample } from './snippets';
import { TryItConsole } from './TryItConsole';

// Convenção de mercado (leitura = informação, criação = sucesso, alteração = atenção,
// remoção = perigo), sempre com o texto do método (a cor nunca é o único sinal).
const METHOD_TONE: Record<HttpMethod, BadgeTone> = {
  get: 'info',
  post: 'success',
  put: 'warning',
  patch: 'warning',
  delete: 'danger',
};

const LANGS: { id: SnippetLang; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
];

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <Badge tone={METHOD_TONE[method]} size="sm" className="w-16 justify-center rounded-xs font-mono uppercase">
      {method}
    </Badge>
  );
}

function typeLabel(field: {
  type: string;
  nullable?: boolean;
  items?: SchemaField;
  enumValues?: string[];
}): string {
  let base: string = field.type;
  if (field.type === 'array' && field.items) base = 'array<' + field.items.type + '>';
  if (field.enumValues && field.enumValues.length > 0) base = field.enumValues.join(' | ');
  return field.nullable ? base + ' | null' : base;
}

function FieldRows({ fields, depth }: { fields: SchemaField[]; depth: number }) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.name + ':' + depth}>
          <div className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-t border-border px-4 py-2 first:border-t-0">
            <div className="min-w-0" style={{ paddingLeft: depth * 12 }}>
              <code className="font-mono text-sm text-text">{f.name}</code>
              {f.required && (
                <span className="ml-2 font-head text-xs uppercase text-danger">obrigatorio</span>
              )}
              {f.description && <p className="mt-0.5 font-body text-xs text-text-low">{f.description}</p>}
            </div>
            <code className="justify-self-end font-mono text-xs text-text-mid">{typeLabel(f)}</code>
          </div>
          {f.type === 'object' && f.fields && f.fields.length > 0 && (
            <FieldRows fields={f.fields} depth={depth + 1} />
          )}
          {f.type === 'array' && f.items && f.items.type === 'object' && f.items.fields && (
            <FieldRows fields={f.items.fields} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  );
}

function SchemaTable({ schema, emptyLabel }: { schema: ResolvedSchema | undefined; emptyLabel: string }) {
  if (!schema) {
    return <p className="font-body text-sm text-text-low">{emptyLabel}</p>;
  }
  const fields = schema.root.type === 'object' ? (schema.root.fields ?? []) : [];
  if (fields.length === 0) {
    return <p className="font-body text-sm text-text-low">{emptyLabel}</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <FieldRows fields={fields} depth={0} />
    </div>
  );
}

function ParamsTable({ params }: { params: ParamField[] }) {
  if (params.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h5 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">Parametros</h5>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {params.map((p) => (
          <div
            key={p.location + ':' + p.name}
            className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-t border-border px-4 py-2 first:border-t-0"
          >
            <div className="min-w-0">
              <code className="font-mono text-sm text-text">{p.name}</code>
              <span className="ml-2 rounded-pill bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-low">
                {p.location}
              </span>
              {p.required && (
                <span className="ml-2 font-head text-xs uppercase text-danger">obrigatorio</span>
              )}
              {p.description && <p className="mt-0.5 font-body text-xs text-text-low">{p.description}</p>}
            </div>
            <code className="justify-self-end font-mono text-xs text-text-mid">{typeLabel(p)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExampleTabs({ endpoint }: { endpoint: Endpoint }) {
  const [lang, setLang] = useState<SnippetLang>('curl');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h5 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">Exemplo</h5>
        <div className="flex gap-1" role="tablist" aria-label="Linguagem do exemplo">
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={lang === l.id}
              onClick={() => setLang(l.id)}
              className={
                'rounded-xs px-2 py-1 font-body text-xs font-bold outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring ' +
                (lang === l.id ? 'bg-surface-3 text-text' : 'text-text-low hover:text-text')
              }
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <CodeBlock code={buildExample(endpoint, lang)} />
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  const [open, setOpen] = useState(false);
  const detailId = 'ep-' + endpoint.method + '-' + endpoint.path.replace(/[^a-zA-Z0-9]/g, '-');

  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-(--dur-fast) ease-ds hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-text"
      >
        <MethodBadge method={endpoint.method} />
        <code className="font-mono text-sm text-text">{endpoint.path}</code>
        {endpoint.scope && (
          <span className="rounded-pill bg-surface-3 px-2 py-0.5 font-mono text-xs text-text-low">
            {endpoint.scope}
          </span>
        )}
        <ChevronDown
          className={
            'ml-auto size-4 shrink-0 text-text-low transition-transform duration-(--dur-base) ease-ds motion-reduce:transition-none ' +
            (open ? 'rotate-180' : '')
          }
          aria-hidden
        />
      </button>

      {endpoint.summary && !open && (
        <p className="px-4 pb-3 font-body text-sm text-text-mid">{endpoint.summary}</p>
      )}

      {open && (
        <div id={detailId} className="flex flex-col gap-4 px-4 pb-4">
          {endpoint.summary && <p className="font-body text-sm text-text-mid">{endpoint.summary}</p>}

          <ParamsTable params={endpoint.params} />

          {endpoint.requestBody && (
            <div className="flex flex-col gap-2">
              <h5 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
                Corpo da requisicao
              </h5>
              <SchemaTable schema={endpoint.requestBody} emptyLabel="Sem corpo." />
            </div>
          )}

          {endpoint.response && (
            <div className="flex flex-col gap-2">
              <h5 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
                Resposta ({endpoint.response.status})
              </h5>
              <SchemaTable schema={endpoint.response.schema} emptyLabel="Sem corpo de resposta." />
            </div>
          )}

          <ExampleTabs endpoint={endpoint} />

          <TryItConsole endpoint={endpoint} />
        </div>
      )}
    </li>
  );
}

export function ApiReference() {
  const { data, isLoading, isError, refetch } = useOpenApi();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-24 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
        <div className="h-24 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-5 py-8 text-center">
        <p className="font-head text-base font-semibold text-text">Não foi possível carregar a referência da API.</p>
        <p className="font-body text-sm text-text-mid">A especificação OpenAPI não respondeu. Tente de novo em instantes.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  const groups = groupEndpoints(data);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.resource} aria-label={g.resource}>
          <h3 className="mb-3 font-mono text-sm font-medium uppercase tracking-wider text-text-mid">{g.resource}</h3>
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {g.endpoints.map((e) => (
              <EndpointRow key={e.method + ':' + e.path} endpoint={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
