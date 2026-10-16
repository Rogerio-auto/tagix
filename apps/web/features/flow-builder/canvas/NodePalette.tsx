'use client';

import { useReactFlow } from '@xyflow/react';
import { Lock, Plus } from 'lucide-react';
import { READ_ONLY_TOOLTIP } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { useFlowEditor } from '../hooks/useFlowEditor';
import {
  CATEGORY_LABEL,
  NODE_CATALOG,
  NODE_KINDS,
  type FlowNodeKind,
  type NodeCategory,
} from '../shared/node-catalog';

const ORDER: NodeCategory[] = ['start', 'output', 'timing', 'logic', 'system', 'external'];

/**
 * Palette esquerda do editor (FLOW_BUILDER seção 9.2) no DS 3.0 (F72-S07).
 *
 * Duas formas de adicionar um nó, com o mesmo resultado:
 *  - arrastar para o canvas (HTML5 DnD; o `dataTransfer` carrega o kind lido no `onDrop`);
 *  - clicar ou Enter/Espaço no item: cria o nó no centro do que está visível e o seleciona
 *    (alternativa de teclado ao arrastar, UX §2.10 / WCAG 2.1.1).
 *
 * Só leitura (F71-S17): os itens dão lugar à explicação — sem edição estrutural possível,
 * não se oferece o que não funciona.
 */
export function NodePalette({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <aside
      aria-label="Componentes do flow"
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface"
    >
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">Componentes</p>
        {!readOnly && (
          <p className="mt-1 text-xs leading-snug text-text-low">Arraste para o canvas ou clique para adicionar.</p>
        )}
      </div>

      {readOnly ? (
        <div className="flex items-start gap-2 px-4 py-4 text-xs leading-snug text-text-mid">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-text-low" aria-hidden />
          <p>{READ_ONLY_TOOLTIP}</p>
        </div>
      ) : (
        <div className="space-y-5 px-3 py-4">
          {ORDER.map((cat) => {
            const kinds = NODE_KINDS.filter((k) => NODE_CATALOG[k].category === cat);
            if (kinds.length === 0) return null;
            return (
              <section key={cat} aria-label={CATEGORY_LABEL[cat]}>
                <p className="mb-1.5 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
                  {CATEGORY_LABEL[cat]}
                </p>
                <ul className="space-y-1">
                  {kinds.map((kind) => (
                    <li key={kind}>
                      <PaletteItem kind={kind} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function PaletteItem({ kind }: { kind: FlowNodeKind }) {
  const meta = NODE_CATALOG[kind];
  const Icon = meta.icon;
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useFlowEditor((s) => s.addNode);
  const select = useFlowEditor((s) => s.select);

  /** Centro da área visível do canvas, com um passo para nós seguidos não se empilharem. */
  const addAtCenter = (): void => {
    const pane = document.querySelector<HTMLElement>('[data-flow-canvas]');
    const rect = pane?.getBoundingClientRect();
    const step = (useFlowEditor.getState().nodes.length % 5) * 24;
    const position = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2 + step, y: rect.top + rect.height / 2 + step })
      : { x: 0, y: 0 };
    addNode(kind, position);
    const created = useFlowEditor.getState().nodes.at(-1);
    if (created) select(created.id);
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/hm-flow-node', kind);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={addAtCenter}
      aria-label={`Adicionar ${meta.label}`}
      className={cn(
        'group flex w-full cursor-grab items-center gap-2.5 rounded-sm border border-transparent px-2 py-1.5 text-left',
        'text-sm text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds motion-reduce:transition-none',
        'hover:border-border hover:bg-surface-2 hover:text-text focus-visible:focus-ring active:cursor-grabbing',
      )}
    >
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-xs border border-border bg-surface-2 text-text-low group-hover:text-text-mid"
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{meta.label}</span>
      <Plus
        className="size-3.5 shrink-0 text-text-low opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
}
