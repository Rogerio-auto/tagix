'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { Field } from '../inspector-fields';

/**
 * Inspector switch (F32-S04). Substitui o anti-pattern "casos separados por vírgula" por:
 * - VariablesPicker para a variável (path dot-notation, ex: contact.plan)
 * - Lista editável de cases (add/remove, mínimo 1)
 * - Toggle case-sensitive
 * - Preview das edges: [case1, case2, ..., default]
 *
 * Edges dinâmicas no SwitchNode renderizam um handle por case + default.
 */
export function SwitchInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const variable = typeof d['variable'] === 'string' ? d['variable'] : '';
  const cases: string[] = Array.isArray(d['cases'])
    ? (d['cases'] as unknown[]).map((c) => (typeof c === 'string' ? c : ''))
    : [''];
  const caseSensitive = d['caseSensitive'] === true;

  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  /** VariablesPicker insere {{token}} — strip braces to get the dot-path used by the handler */
  const handleVarPick = (tokenWithBraces: string) => {
    const stripped = tokenWithBraces.replace(/^\{\{/, '').replace(/\}\}$/, '');
    set({ variable: stripped });
  };

  const addCase = () => {
    set({ cases: [...cases, ''] });
  };

  const updateCase = (index: number, value: string) => {
    const next = cases.map((c, i) => (i === index ? value : c));
    set({ cases: next });
  };

  const removeCase = (index: number) => {
    if (cases.length <= 1) return; // mínimo 1 case
    set({ cases: cases.filter((_, i) => i !== index) });
  };

  const edgePreview = [...cases.filter(Boolean), 'default'];

  return (
    <div className="flex flex-col gap-4">
      {/* Variável */}
      <Field label="Variável">
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            value={variable}
            placeholder="contact.plan"
            onChange={(e) => set({ variable: e.target.value })}
            className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
          <VariablesPicker onPick={handleVarPick} />
        </div>
      </Field>

      {/* Lista de cases */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-low">Casos</span>
          <button
            type="button"
            onClick={addCase}
            className="inline-flex items-center gap-1 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-low transition-colors hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
          >
            <Plus className="size-3.5" aria-hidden />
            Adicionar caso
          </button>
        </div>

        {cases.length === 0 && (
          <p className="text-[11px] text-warning">Adicione pelo menos um caso.</p>
        )}

        {cases.map((c, index) => (
          <div
            key={index}
            className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-3 py-2"
          >
            <input
              type="text"
              value={c}
              placeholder={`caso ${index + 1}`}
              onChange={(e) => updateCase(index, e.target.value)}
              className="flex-1 rounded-md border border-border-2 bg-surface-2 px-2 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => removeCase(index)}
              disabled={cases.length <= 1}
              aria-label="Remover caso"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-text-low transition-colors hover:border-destructive hover:text-destructive focus:outline-none disabled:opacity-30"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {/* Toggle case-sensitive */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-xs font-medium text-text-low">Diferencia maiúsculas</span>
        <button
          type="button"
          role="switch"
          aria-checked={caseSensitive}
          onClick={() => set({ caseSensitive: !caseSensitive })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            caseSensitive ? 'bg-accent' : 'bg-surface-3'
          }`}
        >
          <span
            className={`inline-block size-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
              caseSensitive ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>

      {/* Preview das edges */}
      <div className="rounded-md border border-border-2 bg-surface-1 px-3 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-low">
          Edges geradas
        </p>
        <div className="flex flex-wrap gap-1.5">
          {edgePreview.map((e) => (
            <span
              key={e}
              className={`inline-flex items-center rounded-pill border px-2 py-0.5 font-mono text-[11px] ${
                e === 'default'
                  ? 'border-border-2 bg-surface-2 text-text-low'
                  : 'border-accent/40 bg-accent/10 text-accent'
              }`}
            >
              → {e}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
