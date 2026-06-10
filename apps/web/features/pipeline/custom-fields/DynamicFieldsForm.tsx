'use client';

import { useMemo } from 'react';
import { Input } from '@hm/ui';
import type { CustomFieldDef, CustomFieldValue, CustomFieldValues } from './types';
import { orphanValueKeys, validateCustomFields } from './schema';

export interface DynamicFieldsFormProps {
  defs: readonly CustomFieldDef[];
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
  /** Erros externos por key (server-side); merge com a validação client. */
  errors?: Record<string, string>;
  disabled?: boolean;
}

/** Converte centavos <-> reais para o input de currency. */
function centsToReais(v: CustomFieldValue): string {
  if (typeof v !== 'number') return '';
  return (v / 100).toFixed(2);
}

/**
 * Formulário dinâmico de custom fields (F5-S11, PIPELINE.md §8.3). Renderiza um
 * input por `type` e reporta mudanças via `onChange`. Consumido pelo create/edit
 * de deal (F5-S09) e pelo DealDetailDrawer (F5-S10). DS v2: tokens, zero hex.
 */
export function DynamicFieldsForm({
  defs,
  values,
  onChange,
  errors,
  disabled,
}: DynamicFieldsFormProps): React.JSX.Element {
  const sorted = useMemo(() => [...defs].sort((a, b) => a.position - b.position), [defs]);
  const clientErrors = useMemo(() => validateCustomFields(defs, values), [defs, values]);
  const orphans = useMemo(() => orphanValueKeys(defs, values), [defs, values]);

  function set(key: string, value: CustomFieldValue): void {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      {orphans.length > 0 ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          Alguns valores deste negócio não correspondem mais aos campos atuais e serão ignorados:{' '}
          {orphans.join(', ')}.
        </p>
      ) : null}

      {sorted.map((def) => {
        const error = errors?.[def.key] ?? clientErrors[def.key];
        const value = values[def.key];
        return (
          <div key={def.key} className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor={`cf-${def.key}`}>
              {def.label}
              {def.required ? <span className="ml-1 text-danger">*</span> : null}
            </label>

            {def.type === 'text' || def.type === 'date' ? (
              <Input
                id={`cf-${def.key}`}
                type={def.type === 'date' ? 'date' : 'text'}
                value={typeof value === 'string' ? value : ''}
                disabled={disabled}
                onChange={(e) => set(def.key, e.target.value)}
              />
            ) : null}

            {def.type === 'number' ? (
              <Input
                id={`cf-${def.key}`}
                type="number"
                value={typeof value === 'number' ? String(value) : ''}
                disabled={disabled}
                onChange={(e) => set(def.key, e.target.value === '' ? null : Number(e.target.value))}
              />
            ) : null}

            {def.type === 'currency' ? (
              <Input
                id={`cf-${def.key}`}
                type="number"
                step="0.01"
                inputMode="decimal"
                value={centsToReais(value)}
                disabled={disabled}
                onChange={(e) =>
                  set(def.key, e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))
                }
              />
            ) : null}

            {def.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm text-text-mid">
                <input
                  id={`cf-${def.key}`}
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={(e) => set(def.key, e.target.checked)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                Sim
              </label>
            ) : null}

            {def.type === 'select' ? (
              <select
                id={`cf-${def.key}`}
                value={typeof value === 'string' ? value : ''}
                disabled={disabled}
                onChange={(e) => set(def.key, e.target.value || null)}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
              >
                <option value="">—</option>
                {(def.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : null}

            {def.type === 'multiselect' ? (
              <div className="flex flex-wrap gap-1.5">
                {(def.options ?? []).map((opt) => {
                  const arr = Array.isArray(value) ? value : [];
                  const active = arr.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={disabled}
                      aria-pressed={active}
                      onClick={() =>
                        set(def.key, active ? arr.filter((x) => x !== opt) : [...arr, opt])
                      }
                      className={
                        active
                          ? 'rounded-full bg-brand px-3 py-1 text-xs text-text-on-brand'
                          : 'rounded-full border border-border px-3 py-1 text-xs text-text-mid hover:border-border-strong'
                      }
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {error ? <p className="text-xs text-danger">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
