'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import { FIELD_TYPE_LABELS, type CustomFieldDef, type CustomFieldType } from './types';

export interface CustomFieldsEditorProps {
  defs: CustomFieldDef[];
  onChange: (defs: CustomFieldDef[]) => void;
  disabled?: boolean;
}

const TYPES_WITH_OPTIONS: CustomFieldType[] = ['select', 'multiselect'];

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * Editor de custom field defs (F5-S11, settings). Adiciona/edita/reordena defs
 * persistidas em `pipelines.settings.custom_fields[]`. Reorder por up/down (dnd
 * de stages é do S09). DS v2: tokens, zero hex.
 */
export function CustomFieldsEditor({
  defs,
  onChange,
  disabled,
}: CustomFieldsEditorProps): React.JSX.Element {
  const [newLabel, setNewLabel] = useState('');

  function reposition(list: CustomFieldDef[]): CustomFieldDef[] {
    return list.map((d, i) => ({ ...d, position: i }));
  }

  function update(index: number, patch: Partial<CustomFieldDef>): void {
    const next = defs.map((d, i) => (i === index ? { ...d, ...patch } : d));
    onChange(reposition(next));
  }

  function remove(index: number): void {
    onChange(reposition(defs.filter((_, i) => i !== index)));
  }

  function move(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= defs.length) return;
    const next = [...defs];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(reposition(next));
  }

  function add(): void {
    const label = newLabel.trim();
    if (!label) return;
    const key = slugify(label) || `field_${defs.length + 1}`;
    if (defs.some((d) => d.key === key)) return;
    onChange(
      reposition([
        ...defs,
        { key, label, type: 'text', required: false, position: defs.length },
      ]),
    );
    setNewLabel('');
  }

  return (
    <div className="flex flex-col gap-3">
      {defs.length === 0 ? (
        <p className="text-sm text-text-low">Nenhum campo personalizado ainda.</p>
      ) : null}

      {defs.map((def, index) => (
        <div
          key={def.key}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label="Mover para cima"
                className="text-text-low hover:text-text disabled:opacity-30"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                disabled={disabled || index === defs.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Mover para baixo"
                className="text-text-low hover:text-text disabled:opacity-30"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>

            <Input
              value={def.label}
              disabled={disabled}
              aria-label="Rótulo do campo"
              onChange={(e) => update(index, { label: e.target.value })}
              className="flex-1"
            />

            <select
              value={def.type}
              disabled={disabled}
              aria-label="Tipo do campo"
              onChange={(e) => update(index, { type: e.target.value as CustomFieldType })}
              className="rounded-md border border-border bg-surface px-2 py-2 text-sm text-text"
            >
              {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-text-mid">
              <input
                type="checkbox"
                checked={def.required}
                disabled={disabled}
                onChange={(e) => update(index, { required: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
              Obrigatório
            </label>

            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(index)}
              aria-label="Remover campo"
              className="text-text-low hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          {TYPES_WITH_OPTIONS.includes(def.type) ? (
            <Input
              value={(def.options ?? []).join(', ')}
              disabled={disabled}
              placeholder="Opções separadas por vírgula"
              aria-label="Opções"
              onChange={(e) =>
                update(index, {
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : null}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          disabled={disabled}
          placeholder="Nome do novo campo"
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1"
        />
        <Button variant="secondary" disabled={disabled || !newLabel.trim()} onClick={add}>
          <Plus className="size-4" />
          Adicionar campo
        </Button>
      </div>
    </div>
  );
}
