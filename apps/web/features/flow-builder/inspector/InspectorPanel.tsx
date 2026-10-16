'use client';

import type { ReactNode } from 'react';
import { Lock, MousePointerClick, Trash2 } from 'lucide-react';
import { IconButton } from '@hm/ui';
import { READ_ONLY_TOOLTIP } from '@/shared/components/account-banner';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useFlowEditor, type FlowEditorNode } from '../hooks/useFlowEditor';
import { CATEGORY_LABEL, NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';
import { nodeInspectors } from '../nodes/nodeInspectors';

/** Cabeçalho + form do node selecionado, reaproveitado no aside (desktop) e no Sheet (mobile). */
function InspectorBody({
  node,
  showDelete,
  readOnly,
}: {
  node: FlowEditorNode;
  showDelete: boolean;
  readOnly: boolean;
}): React.JSX.Element {
  const deleteNodes = useFlowEditor((s) => s.deleteNodes);
  const kind = (node.type ?? 'message') as FlowNodeKind;
  const meta = NODE_CATALOG[kind];
  const NodeInspector = nodeInspectors[kind];
  const isTrigger = node.type === 'trigger';
  const Icon = meta?.icon;

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-2 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xs border border-border bg-surface-2 text-text-mid"
            >
              <Icon className="size-4" />
            </span>
          )}
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
              {meta ? CATEGORY_LABEL[meta.category] : 'Nó'}
            </p>
            <h2 className="truncate font-head text-base font-semibold text-text">{meta?.label ?? node.type}</h2>
            <p className="truncate font-mono text-[11px] text-text-low">{node.id}</p>
          </div>
        </div>

        {/* Excluir: desabilitado no gatilho (com a explicação); oculto no mobile read-first e em só leitura. */}
        {showDelete && !readOnly && (
          <div className="group relative shrink-0">
            <IconButton
              size="sm"
              variant="danger"
              icon={<Trash2 />}
              onClick={() => {
                if (!isTrigger) deleteNodes([node.id]);
              }}
              disabled={isTrigger}
              aria-label={isTrigger ? 'O gatilho não pode ser excluído' : 'Excluir nó'}
            />
            {isTrigger && (
              <div
                aria-hidden
                className="pointer-events-none absolute right-0 top-9 z-50 hidden w-max max-w-45 rounded-sm border border-border-2 bg-bg-elevated px-2.5 py-1.5 text-xs text-text shadow-ds-2 group-hover:block"
              >
                O gatilho não pode ser excluído
              </div>
            )}
          </div>
        )}
      </div>

      {meta?.deferred && <p className="mb-3 text-xs text-warn">Este nó ainda não executa.</p>}

      {readOnly && (
        <p className="mb-4 flex items-start gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs leading-snug text-text-mid">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-text-low" aria-hidden />
          {READ_ONLY_TOOLTIP}
        </p>
      )}

      {/* Só leitura: um único `disabled` no fieldset trava todos os campos do inspector. */}
      <fieldset
        disabled={readOnly}
        // Campos travados com a mesma linguagem do Input do DS (fundo recolhido, cursor de bloqueio).
        className="m-0 min-w-0 border-0 p-0 [&_:disabled]:cursor-not-allowed [&_:disabled]:bg-surface [&_:disabled]:opacity-60"
      >
        <legend className="sr-only">Propriedades do nó {meta?.label ?? node.type}</legend>
        <NodeInspector nodeId={node.id} />
      </fieldset>
    </>
  );
}

/**
 * Container do inspector (FLOW_BUILDER seção 9.2) no DS 3.0 (F72-S07): resolve qual
 * inspector renderizar pelo node selecionado. Botão de excluir no cabeçalho (guard: o
 * gatilho não pode ser excluído — botão desabilitado com a explicação). F32-S01.
 *
 * Mobile (< md, F36-S11): o inspector lateral vira full-`Sheet` (UX §2.3). Tocar um node no
 * canvas read-first seleciona + abre o sheet; fechar deseleciona. Como é read-first, o botão de
 * exclusão (edição estrutural) fica oculto no mobile.
 *
 * Só leitura (F71-S17): os campos ficam travados por um `<fieldset disabled>` e a explicação
 * aparece no topo; a exclusão some.
 *
 * Sem nó selecionado (desktop), o painel mostra o contexto do flow (`idle`, ex.: execuções
 * ativas) acima da dica — o canvas fica livre de painéis flutuantes por cima do grafo.
 */
export function InspectorPanel({ readOnly = false, idle }: { readOnly?: boolean; idle?: ReactNode }) {
  const { isMobile } = useBreakpoint();
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const nodes = useFlowEditor((s) => s.nodes);
  const select = useFlowEditor((s) => s.select);

  const node = nodes.find((n) => n.id === selectedNodeId);

  // Mobile: inspector como full-sheet, montado/desmontado pelo node selecionado.
  if (isMobile) {
    const kind = node ? ((node.type ?? 'message') as FlowNodeKind) : null;
    const heading = kind ? (NODE_CATALOG[kind]?.label ?? node?.type) : 'Propriedades do nó';
    return (
      <Sheet
        open={Boolean(node)}
        onClose={() => select(null)}
        variant="full"
        title={heading}
        ariaLabel="Propriedades do nó"
      >
        {node && <InspectorBody node={node} showDelete={false} readOnly={readOnly} />}
      </Sheet>
    );
  }

  if (!node) {
    return (
      <aside
        aria-label="Propriedades do nó"
        className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface"
      >
        {idle && <div className="border-b border-border p-4">{idle}</div>}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-sm border border-border bg-surface-2 text-text-low"
          >
            <MousePointerClick className="size-5" />
          </span>
          <p className="font-head text-sm font-semibold text-text">Nenhum nó selecionado</p>
          <p className="max-w-56 text-xs leading-snug text-text-low">
            Clique num nó do canvas, ou foque com Tab e pressione Enter, para editar as propriedades.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Propriedades do nó" className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface p-4">
      <InspectorBody node={node} showDelete readOnly={readOnly} />
    </aside>
  );
}
