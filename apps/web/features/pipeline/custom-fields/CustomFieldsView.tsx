'use client';

import { useMemo } from 'react';
import type { CustomFieldDef, CustomFieldValues } from './types';

export interface CustomFieldsViewProps {
  defs: readonly CustomFieldDef[];
  values: CustomFieldValues;
}

function formatValue(def: CustomFieldDef, value: unknown): string {
  if (value == null || value === '') return '—';
  switch (def.type) {
    case 'currency':
      return typeof value === 'number'
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100)
        : '—';
    case 'boolean':
      return value === true ? 'Sim' : 'Não';
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : '—';
    default:
      return String(value);
  }
}

/** Visão read-only dos custom fields (F5-S11), usada pelo DealDetailDrawer (F5-S10). */
export function CustomFieldsView({ defs, values }: CustomFieldsViewProps): React.JSX.Element {
  const sorted = useMemo(() => [...defs].sort((a, b) => a.position - b.position), [defs]);
  if (sorted.length === 0) {
    return <p className="text-sm text-text-low">Nenhum campo personalizado.</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {sorted.map((def) => (
        <div key={def.key} className="flex flex-col gap-0.5">
          <dt className="text-xs text-text-low">{def.label}</dt>
          <dd className="text-sm text-text">{formatValue(def, values[def.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
