'use client';

import { useState, type ReactNode } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { Field, NumberField, SelectField, TextField } from '../inspector-fields';

interface HeaderEntry {
  key: string;
  value: string;
}
interface MappingEntry {
  path: string;
  variable: string;
}

type BodyMode = 'none' | 'json' | 'raw';

const METHOD_OPTIONS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'PATCH', label: 'PATCH' },
  { value: 'DELETE', label: 'DELETE' },
] as const;

const BODY_MODE_OPTIONS = [
  { value: 'none', label: 'Sem corpo' },
  { value: 'json', label: 'JSON' },
  { value: 'raw', label: 'Texto cru' },
] as const;

/** Le headers do node tolerando o legado `Record<string,string>`. */
function readHeaders(raw: unknown): HeaderEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
      .map((h) => ({ key: String(h['key'] ?? ''), value: String(h['value'] ?? '') }));
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: String(value ?? ''),
    }));
  }
  return [];
}

function readMapping(raw: unknown): MappingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({ path: String(m['path'] ?? ''), variable: String(m['variable'] ?? '') }));
}

const PATH_SEGMENT = /\.([\w$-]+)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(\d+)\s*\]/g;

/** Valida a sintaxe de um JSONPath simples (`$.a.b[0]['c']`) para feedback no inspector. */
function isValidJsonPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  const body = trimmed.startsWith('$') ? trimmed.slice(1) : trimmed;
  if (body === '') return true;
  PATH_SEGMENT.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matched = false;
  while ((match = PATH_SEGMENT.exec(body)) !== null) {
    if (match.index !== lastIndex) return false;
    lastIndex = PATH_SEGMENT.lastIndex;
    matched = true;
  }
  return matched && lastIndex === body.length;
}

export function HttpRequestInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);

  // Alvo do VariablesPicker: corpo ou um header especifico (rastreio de foco).
  const [varTarget, setVarTarget] = useState<{ kind: 'body' } | { kind: 'header'; index: number }>(
    { kind: 'body' },
  );

  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const headers = readHeaders(d['headers']);
  const mapping = readMapping(d['responseMapping']);
  const bodyMode = ((d['bodyMode'] as BodyMode | undefined) ?? 'none') as BodyMode;
  const body = (d['body'] as string | undefined) ?? '';

  const setHeaders = (next: HeaderEntry[]) => set({ headers: next });
  const setMapping = (next: MappingEntry[]) => set({ responseMapping: next });

  const insertVariable = (token: string) => {
    if (varTarget.kind === 'body') {
      set({ body: `${body}${token}` });
      return;
    }
    const idx = varTarget.index;
    const current = headers[idx];
    if (!current) return;
    const next = headers.map((h, i) => (i === idx ? { ...h, value: `${h.value}${token}` } : h));
    setHeaders(next);
  };

  const mappedVars = mapping.map((m) => m.variable.trim()).filter((v) => v.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Requisicao */}
      <section className="flex flex-col gap-3">
        <SelectField
          label="Metodo"
          value={((d['method'] as string) ?? '') || 'GET'}
          options={METHOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => set({ method: v })}
        />
        <TextField
          label="URL"
          value={(d['url'] as string) ?? ''}
          placeholder="https://api.exemplo.com/hook"
          hint="Aceita variaveis {{...}}. Edges: success / error."
          onChange={(v) => set({ url: v })}
        />
      </section>

      {/* Headers */}
      <section className="flex flex-col gap-2">
        <SectionHeader title="Cabecalhos">
          <VariablesPicker onPick={insertVariable} flowVariables={mappedVars} />
        </SectionHeader>
        {headers.length === 0 ? (
          <p className="text-[11px] text-text-low">Nenhum cabecalho. Adicione pares chave/valor.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={h.key}
                  placeholder="Authorization"
                  onChange={(e) =>
                    setHeaders(headers.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
                  }
                  className="w-2/5 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
                />
                <input
                  type="text"
                  value={h.value}
                  placeholder="Bearer {{webhook_response.body}}"
                  onFocus={() => setVarTarget({ kind: 'header', index: i })}
                  onChange={(e) =>
                    setHeaders(
                      headers.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                  className="flex-1 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
                />
                <RowRemoveButton
                  label="Remover cabecalho"
                  onClick={() => setHeaders(headers.filter((_, idx) => idx !== i))}
                />
              </div>
            ))}
          </div>
        )}
        <AddRowButton
          label="Adicionar cabecalho"
          onClick={() => setHeaders([...headers, { key: '', value: '' }])}
        />
      </section>

      {/* Corpo */}
      <section className="flex flex-col gap-3">
        <SelectField
          label="Corpo"
          value={bodyMode}
          options={BODY_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => set({ bodyMode: v })}
        />
        {bodyMode !== 'none' && (
          <Field
            label={bodyMode === 'json' ? 'Corpo (JSON)' : 'Corpo (texto)'}
            hint={
              bodyMode === 'json'
                ? 'JSON com variaveis {{...}}. Validado no envio.'
                : 'Texto cru com variaveis {{...}}.'
            }
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-end">
                <VariablesPicker
                  onPick={(token) => {
                    setVarTarget({ kind: 'body' });
                    set({ body: `${body}${token}` });
                  }}
                  flowVariables={mappedVars}
                />
              </div>
              <textarea
                value={body}
                onFocus={() => setVarTarget({ kind: 'body' })}
                placeholder={bodyMode === 'json' ? '{\n  "id": "{{contact.phone}}"\n}' : ''}
                onChange={(e) => set({ body: e.target.value })}
                className="min-h-[110px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-mono text-[13px] text-text focus:border-accent focus:outline-none"
              />
              {bodyMode === 'json' && body.trim().length > 0 && <JsonValidity value={body} />}
            </div>
          </Field>
        )}
      </section>

      {/* Retry */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Retentativas" />
        <NumberField
          label="Tentativas (max)"
          value={readNum(d, 'retryPolicy', 'maxAttempts')}
          hint="Entre 1 e 10. Padrao 3. 5xx retenta; 4xx vai direto p/ error."
          onChange={(v) => setRetry(d, set, { maxAttempts: clamp(v, 1, 10) })}
        />
        <NumberField
          label="Backoff inicial (ms)"
          value={readNum(d, 'retryPolicy', 'initialDelayMs')}
          hint="Atraso da 1a retentativa; dobra a cada tentativa. Padrao 1000."
          onChange={(v) => setRetry(d, set, { initialDelayMs: Math.max(0, v) })}
        />
        <NumberField
          label="Backoff maximo (ms)"
          value={readNum(d, 'retryPolicy', 'maxDelayMs')}
          hint="Teto do atraso exponencial. Padrao 30000."
          onChange={(v) => setRetry(d, set, { maxDelayMs: Math.max(0, v) })}
        />
      </section>

      {/* Mapeamento da resposta */}
      <section className="flex flex-col gap-2">
        <SectionHeader title="Mapear resposta" />
        <p className="text-[11px] text-text-low">
          JSONPath (relativo ao corpo da resposta) para uma variavel usavel a jusante como{' '}
          <span className="font-mono text-text-mid">{'{{nome}}'}</span>.
        </p>
        {mapping.length === 0 ? (
          <p className="text-[11px] text-text-low">Nenhum mapeamento.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mapping.map((m, i) => {
              const valid = isValidJsonPath(m.path);
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="relative w-1/2">
                    <input
                      type="text"
                      value={m.path}
                      placeholder="$.data.id"
                      onChange={(e) =>
                        setMapping(
                          mapping.map((x, idx) => (idx === i ? { ...x, path: e.target.value } : x)),
                        )
                      }
                      className={cn(
                        'w-full rounded-md border bg-surface-2 px-2.5 py-1.5 pr-7 font-mono text-[13px] text-text focus:outline-none',
                        m.path.trim().length === 0
                          ? 'border-border-2 focus:border-accent'
                          : valid
                            ? 'border-success/50 focus:border-success'
                            : 'border-danger/60 focus:border-danger',
                      )}
                    />
                    {m.path.trim().length > 0 && (
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                        {valid ? (
                          <Check className="size-3.5 text-success" aria-hidden />
                        ) : (
                          <X className="size-3.5 text-danger" aria-hidden />
                        )}
                      </span>
                    )}
                  </div>
                  <span className="text-text-low" aria-hidden>
                    →
                  </span>
                  <input
                    type="text"
                    value={m.variable}
                    placeholder="order_id"
                    onChange={(e) =>
                      setMapping(
                        mapping.map((x, idx) =>
                          idx === i ? { ...x, variable: e.target.value } : x,
                        ),
                      )
                    }
                    className="flex-1 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] text-text focus:border-accent focus:outline-none"
                  />
                  <RowRemoveButton
                    label="Remover mapeamento"
                    onClick={() => setMapping(mapping.filter((_, idx) => idx !== i))}
                  />
                </div>
              );
            })}
          </div>
        )}
        <AddRowButton
          label="Adicionar mapeamento"
          onClick={() => setMapping([...mapping, { path: '', variable: '' }])}
        />
      </section>
    </div>
  );
}

function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-low">{title}</h4>
      {children}
    </div>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border-2 px-2.5 py-1.5 text-[12px] font-medium text-text-low transition-colors hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
    >
      <Plus className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function RowRemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-low transition-colors hover:bg-danger/10 hover:text-danger focus:shadow-glow-sm focus:outline-none"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  );
}

function JsonValidity({ value }: { value: string }) {
  let ok = true;
  try {
    JSON.parse(value);
  } catch {
    ok = false;
  }
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-success">
      <Check className="size-3" aria-hidden />
      JSON valido
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-warning">
      <X className="size-3" aria-hidden />
      JSON invalido (ainda pode conter variaveis {'{{...}}'})
    </span>
  );
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

function readNum(
  d: Record<string, unknown>,
  group: string,
  key: string,
): number | undefined {
  const g = d[group];
  if (typeof g !== 'object' || g === null) return undefined;
  const v = (g as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

function setRetry(
  d: Record<string, unknown>,
  set: (patch: Record<string, unknown>) => void,
  patch: Record<string, number>,
) {
  const current =
    typeof d['retryPolicy'] === 'object' && d['retryPolicy'] !== null
      ? (d['retryPolicy'] as Record<string, unknown>)
      : {};
  set({ retryPolicy: { ...current, ...patch } });
}
