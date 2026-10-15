'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { useFlowHelpers } from '../../shared/helpers-context';
import { Field } from '../inspector-fields';

/**
 * Inspector remove_tag (F32-S02). Substitui DeferredNotice por TagPicker real.
 * Consome useFlowHelpers().tags (lista do workspace). Salva tagId no node data.
 */
export function RemoveTagInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const { tags, isLoading } = useFlowHelpers();

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const tagId = typeof d['tagId'] === 'string' ? d['tagId'] : '';
  const selected = tags.find((t) => t.id === tagId);

  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Tag a remover">
        {isLoading ? (
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-low">
            Carregando…
          </div>
        ) : tags.length === 0 ? (
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-low">
            Nenhuma tag encontrada.{' '}
            <a href="/settings/workspace" className="text-brand-text underline">
              Crie tags em Configurações
            </a>
          </div>
        ) : (
          <select
            value={tagId}
            onChange={(e) => set({ tagId: e.target.value })}
            className="rounded-sm border border-border bg-surface-2 hover:border-border-2 px-3 py-2 text-sm text-text outline-none focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring"
          >
            <option value="">Selecione uma tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* Preview chip da tag selecionada */}
      {selected && (
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-3 shrink-0 rounded-pill"
            style={{ backgroundColor: selected.color }}
            aria-hidden
          />
          <span className="text-sm text-text">{selected.name}</span>
        </div>
      )}
    </div>
  );
}
