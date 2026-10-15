'use client';

/**
 * Console "Try it" da Leadium API (F41-S02). Por endpoint, com toggle
 * Sandbox (default) / Real. Os dois muros do "nao misture" (SUPPORT.md 6.3):
 *
 *   1. Sandbox e mock 100% client-side gerado do response schema (buildSampleResponse
 *      do S01). NUNCA emite fetch, nunca toca dado real. Vale p/ TODOS os endpoints,
 *      inclusive mutacoes.
 *   2. Real chama /api/v1 com a API key colada (Bearer), escopada ao workspace da
 *      chave pelo backend (RLS). SOMENTE GET. Mutacoes ficam bloqueadas no Real e
 *      sao forcadas ao Sandbox. A key vive so em memoria (useState) — nunca
 *      localStorage/sessionStorage/cookie, nunca logada, some ao desmontar.
 */
import { useMemo, useState } from 'react';
import { Play, ShieldCheck, Zap } from 'lucide-react';
import { Badge, Button } from '@hm/ui';
import type { Endpoint, ParamField } from './openapi';
import { buildSampleBody, buildSampleResponse } from './snippets';

type Mode = 'sandbox' | 'real';

interface RunResult {
  mode: Mode;
  status: number;
  statusText: string;
  durationMs: number;
  body: string;
  headers?: Record<string, string>;
}

/** Preenche path params do template com os valores do form. */
function fillPath(path: string, pathValues: Record<string, string>): string {
  let out = path;
  for (const [name, value] of Object.entries(pathValues)) {
    out = out.replace('{' + name + '}', encodeURIComponent(value));
  }
  return out;
}

/** Monta a query string a partir dos valores nao-vazios do form. */
function buildQuery(params: ParamField[], queryValues: Record<string, string>): string {
  const pairs: string[] = [];
  for (const p of params) {
    if (p.location !== 'query') continue;
    const v = queryValues[p.name];
    if (v != null && v !== '') {
      pairs.push(encodeURIComponent(p.name) + '=' + encodeURIComponent(v));
    }
  }
  return pairs.length > 0 ? '?' + pairs.join('&') : '';
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * MURO 1 — execucao Sandbox: 100% client-side, SEM rede. Gera a resposta mock a
 * partir do response schema do endpoint (S01). Esta funcao nao tem (e nunca pode
 * ter) qualquer chamada a fetch/api-client.
 */
function runSandbox(endpoint: Endpoint): RunResult {
  const started = performance.now();
  const mock = buildSampleResponse(endpoint.response?.schema);
  const status = Number(endpoint.response?.status ?? '200');
  return {
    mode: 'sandbox',
    status: Number.isFinite(status) ? status : 200,
    statusText: 'Simulado',
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    body: prettyJson(mock),
  };
}

/**
 * MURO 2 — execucao Real: somente GET. A chave vai apenas no header Authorization
 * desta request (nunca persistida/logada). `credentials: 'omit'` garante que a
 * sessao por cookie nao se mistura — o acesso e estritamente o da API key, isolado
 * por RLS no backend. Mutacoes nunca chegam aqui (gate no componente).
 */
async function runReal(endpoint: Endpoint, url: string, apiKey: string): Promise<RunResult> {
  if (endpoint.method !== 'get') {
    // defesa em profundidade: o componente ja bloqueia, mas garantimos aqui.
    throw new Error('Modo real permite apenas requisições GET.');
  }
  const started = performance.now();
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + apiKey },
    credentials: 'omit',
  });
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  const text = await res.text();
  let body = text;
  try {
    body = prettyJson(JSON.parse(text));
  } catch {
    // resposta nao-JSON: mantem o texto cru.
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { mode: 'real', status: res.status, statusText: res.statusText, durationMs, body, headers };
}

export function TryItConsole({ endpoint }: { endpoint: Endpoint }) {
  const isMutating = endpoint.mutating;
  // Mutacoes so rodam no Sandbox; o modo Real nem fica disponivel p/ elas.
  const [mode, setMode] = useState<Mode>('sandbox');
  const effectiveMode: Mode = isMutating ? 'sandbox' : mode;

  const pathParamDefs = useMemo(
    () => endpoint.params.filter((p) => p.location === 'path'),
    [endpoint.params],
  );
  const queryParamDefs = useMemo(
    () => endpoint.params.filter((p) => p.location === 'query'),
    [endpoint.params],
  );

  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [queryValues, setQueryValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState<string>(() =>
    endpoint.requestBody ? prettyJson(buildSampleBody(endpoint.requestBody)) : '',
  );
  // A API key vive SO aqui (memoria). Sem localStorage/sessionStorage/cookie.
  const [apiKey, setApiKey] = useState('');

  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setPathValue(name: string, value: string): void {
    setPathValues((prev) => ({ ...prev, [name]: value }));
  }
  function setQueryValue(name: string, value: string): void {
    setQueryValues((prev) => ({ ...prev, [name]: value }));
  }

  async function execute(): Promise<void> {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      if (effectiveMode === 'sandbox') {
        setResult(runSandbox(endpoint));
        return;
      }
      if (!apiKey.trim()) {
        setError('Cole uma API key para executar no modo real.');
        return;
      }
      const url = '/api/v1' + fillPath(endpoint.path.replace('/api/v1', ''), pathValues) + buildQuery(endpoint.params, queryValues);
      setResult(await runReal(endpoint, url, apiKey.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar a requisição.');
    } finally {
      setRunning(false);
    }
  }

  const realBadge = effectiveMode === 'real';

  return (
    <div
      className={
        'flex flex-col gap-3 rounded-md border p-4 ' +
        (realBadge ? 'border-warn/25 bg-warn/[0.06]' : 'border-border bg-surface-2')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-head text-base font-semibold text-text">Testar</span>
          {effectiveMode === 'sandbox' ? (
            <Badge tone="success" size="sm">
              <ShieldCheck className="size-3" aria-hidden /> Simulação — nenhum dado real tocado
            </Badge>
          ) : (
            <Badge tone="warning" size="sm">
              <Zap className="size-3" aria-hidden /> Real — chama a API com sua chave
            </Badge>
          )}
        </div>

        {!isMutating && (
          <div className="flex gap-1" role="tablist" aria-label="Modo de execução">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'sandbox'}
              onClick={() => setMode('sandbox')}
              className={
                'rounded-xs px-2.5 py-1 font-body text-xs font-bold outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring ' +
                (mode === 'sandbox' ? 'bg-surface-3 text-text' : 'text-text-low hover:text-text')
              }
            >
              Sandbox
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'real'}
              onClick={() => setMode('real')}
              className={
                'rounded-xs px-2.5 py-1 font-body text-xs font-bold outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring ' +
                (mode === 'real' ? 'bg-surface-3 text-text' : 'text-text-low hover:text-text')
              }
            >
              Real
            </button>
          </div>
        )}
      </div>

      {isMutating && (
        <p className="rounded-sm border border-warn/25 bg-warn/10 px-3 py-2 font-body text-sm text-text-mid">
          Esta operação tem efeito (escrita). Para não disparar nada de verdade, ela só roda no
          Sandbox — o modo real é desabilitado aqui.
        </p>
      )}

      {pathParamDefs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h6 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
            Parâmetros de path
          </h6>
          {pathParamDefs.map((p) => (
            <label key={p.name} className="flex flex-col gap-1">
              <span className="font-mono text-xs text-text-mid">{p.name}</span>
              <input
                type="text"
                value={pathValues[p.name] ?? ''}
                onChange={(e) => setPathValue(p.name, e.target.value)}
                placeholder={p.format ?? p.type}
                className="h-9 rounded-sm border border-border bg-surface px-2.5 font-mono text-sm text-text outline-none transition-[border-color] duration-(--dur-fast) hover:border-border-2 focus:border-brand-text focus-visible:focus-ring"
              />
            </label>
          ))}
        </div>
      )}

      {queryParamDefs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h6 className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
            Query
          </h6>
          {queryParamDefs.map((p) => (
            <label key={p.name} className="flex flex-col gap-1">
              <span className="font-mono text-xs text-text-mid">
                {p.name}
                {p.required && <span className="ml-1 text-danger">*</span>}
              </span>
              <input
                type="text"
                value={queryValues[p.name] ?? ''}
                onChange={(e) => setQueryValue(p.name, e.target.value)}
                placeholder={p.enumValues ? p.enumValues.join(' | ') : (p.format ?? p.type)}
                className="h-9 rounded-sm border border-border bg-surface px-2.5 font-mono text-sm text-text outline-none transition-[border-color] duration-(--dur-fast) hover:border-border-2 focus:border-brand-text focus-visible:focus-ring"
              />
            </label>
          ))}
        </div>
      )}

      {endpoint.requestBody && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
            Corpo (JSON)
          </span>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={6}
            spellCheck={false}
            className="resize-y rounded-sm border border-border bg-surface px-2.5 py-1.5 font-mono text-sm text-text outline-none transition-[border-color] duration-(--dur-fast) hover:border-border-2 focus:border-brand-text focus-visible:focus-ring"
          />
        </label>
      )}

      {effectiveMode === 'real' && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-low">
            API key (Bearer)
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="hm_..."
            autoComplete="off"
            className="h-9 rounded-sm border border-border bg-surface px-2.5 font-mono text-sm text-text outline-none transition-[border-color] duration-(--dur-fast) hover:border-border-2 focus:border-brand-text focus-visible:focus-ring"
          />
          <span className="font-body text-xs text-text-low">
            A chave fica só na memória desta aba e some ao sair. Nunca é salva nem registrada.
          </span>
        </label>
      )}

      <div className="flex items-center gap-3">
        {/* Secundário: o CTA neon da tela é outro; aqui é uma ação de ferramenta. */}
        <Button
          variant="secondary"
          size="sm"
          loading={running}
          leftIcon={<Play className="size-3.5" aria-hidden />}
          onClick={() => void execute()}
        >
          {effectiveMode === 'sandbox' ? 'Simular' : 'Executar'}
        </Button>
        {result && (
          <span className="font-mono text-xs tabular-nums text-text-low">{result.durationMs} ms</span>
        )}
      </div>

      {error && (
        <p className="rounded-sm border border-danger/25 bg-danger/10 px-3 py-2 font-body text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={
                'rounded-xs border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ' +
                (result.status >= 200 && result.status < 300
                  ? 'border-success/25 bg-success/10 text-success'
                  : 'border-danger/25 bg-danger/10 text-danger')
              }
            >
              {result.status} {result.statusText}
            </span>
            <span className="font-mono text-xs uppercase tracking-wider text-text-low">
              {result.mode === 'sandbox' ? 'resposta simulada' : 'resposta real'}
            </span>
          </div>
          <pre
            tabIndex={0}
            className="max-h-80 overflow-auto rounded-sm border border-border bg-surface-inset px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus-visible:focus-ring"
          >
            <code>{result.body}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
