'use client';

// Inspector 'ab_split' (F31-S11). Distribui execucoes por variantes ponderadas.
// A soma dos pesos e exibida em tempo real; o canvas pode ter N variantes
// (keys dinamicas), mas o catalogo inicial so conecta edges 'a'/'b'.
import { Plus, Trash2 } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';

interface Variant {
  key: string;
  weight: number;
}

function readVariants(raw: unknown): Variant[] {
  if (!Array.isArray(raw)) return [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      key: typeof o['key'] === 'string' && o['key'].trim() ? o['key'] : 'a',
      weight: typeof o['weight'] === 'number' ? o['weight'] : 0,
    };
  });
}

export function AbSplitInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const variants = readVariants(d['variants']);
  const total = variants.reduce((sum, v) => sum + v.weight, 0);

  const setVariants = (next: Variant[]) => update(nodeId, { variants: next });

  const addVariant = () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const usedKeys = new Set(variants.map((v) => v.key));
    const nextKey = keys.find((k) => !usedKeys.has(k)) ?? `v${variants.length + 1}`;
    setVariants([...variants, { key: nextKey, weight: 0 }]);
  };

  const updateVariant = (index: number, patch: Partial<Variant>) =>
    setVariants(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const removeVariant = (index: number) => {
    if (variants.length <= 2) return; // minimo de 2 variantes
    setVariants(variants.filter((_, i) => i !== index));
  };

  const isBalanced = Math.abs(total - 100) < 0.01;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-low">Variantes</span>
        <button
          type="button"
          onClick={addVariant}
          className="inline-flex items-center gap-1 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-low transition-colors hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
        >
          <Plus className="size-3.5" aria-hidden />
          Adicionar
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {variants.map((variant, index) => (
          <div
            key={index}
            className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-1 px-3 py-2"
          >
            {/* Key da edge */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-text-low">Edge</span>
              <input
                type="text"
                value={variant.key}
                maxLength={12}
                onChange={(e) => updateVariant(index, { key: e.target.value.trim().toLowerCase() })}
                className="w-14 rounded-md border border-border-2 bg-surface-2 px-2 py-1.5 text-center font-mono text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>

            {/* Peso */}
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-text-low">Peso</span>
              <input
                type="number"
                min={0}
                max={9999}
                step={1}
                value={variant.weight}
                onChange={(e) => updateVariant(index, { weight: Number(e.target.value) || 0 })}
                className="w-full rounded-md border border-border-2 bg-surface-2 px-2 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
              />
            </div>

            {/* % proporcional */}
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[10px] text-text-low">%</span>
              <span className="min-w-[40px] text-right text-sm text-text-mid">
                {total > 0 ? Math.round((variant.weight / total) * 100) : 0}%
              </span>
            </div>

            {/* Remover */}
            <button
              type="button"
              onClick={() => removeVariant(index)}
              disabled={variants.length <= 2}
              aria-label="Remover variante"
              className="mt-4 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-text-low transition-colors hover:border-danger hover:text-danger focus:outline-none disabled:opacity-30"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {/* Indicador de soma */}
      <div
        className={`flex items-center justify-between rounded-md border px-3 py-2 text-[11px] ${
          isBalanced
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-warning/30 bg-warning/10 text-warning'
        }`}
      >
        <span>Soma dos pesos</span>
        <span className="font-mono font-semibold">{total}</span>
      </div>

      <p className="text-[11px] text-text-low">
        Os pesos são relativos — não precisam somar 100. A variante sorteada roteia pela edge de
        mesmo nome. As edges devem estar conectadas no canvas.
      </p>
    </div>
  );
}
