'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFlowEditor, type FlowEditorNode } from '../hooks/useFlowEditor';
import { nodeTypes } from '../nodes/nodeTypes';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';

/** Rótulo de SR por node (UX §2.10): tipo legível + nome configurado, se houver. */
function nodeAriaLabel(node: Node<Record<string, unknown>>): string {
  const kind = node.type as FlowNodeKind | undefined;
  const meta = kind ? NODE_CATALOG[kind] : undefined;
  const typeLabel = meta?.label ?? 'Nó';
  const rawName = node.data?.['label'] ?? node.data?.['name'];
  const name = typeof rawName === 'string' && rawName.trim() ? `: ${rawName.trim()}` : '';
  return `${typeLabel}${name}. Enter ou setas selecionam; o painel lateral edita.`;
}

interface CanvasInnerProps {
  /**
   * Modo somente-leitura (F36-S11 — mobile read-first). Mantém pan/zoom e seleção
   * (tocar node seleciona + abre o inspector como full-sheet), mas desabilita a
   * edição estrutural do grafo: sem arrastar nodes, sem conectar edges, sem DnD do
   * palette e sem Delete por teclado. A edição estrutural fica melhor em `md+`.
   */
  readOnly?: boolean;
}

/**
 * Canvas ReactFlow (FLOW_BUILDER secao 9.1/9.2). DnD do palette cria node no ponto do drop;
 * edges conectam handles; selecao alimenta o inspector. O store (zustand) e a fonte de verdade.
 */
function CanvasInner({ readOnly = false }: CanvasInnerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useFlowEditor((s) => s.nodes);
  const edges = useFlowEditor((s) => s.edges);

  // Injeta `ariaLabel` por node sem mutar o store (fonte de verdade do zustand).
  const a11yNodes = useMemo<FlowEditorNode[]>(
    () => nodes.map((n) => ({ ...n, ariaLabel: nodeAriaLabel(n) })),
    [nodes],
  );
  const onNodesChange = useFlowEditor((s) => s.onNodesChange);
  const onEdgesChange = useFlowEditor((s) => s.onEdgesChange);
  const connect = useFlowEditor((s) => s.connect);
  const addNode = useFlowEditor((s) => s.addNode);
  const select = useFlowEditor((s) => s.select);
  const deleteNodes = useFlowEditor((s) => s.deleteNodes);

  const onConnect = useCallback(
    (conn: Connection) => {
      const [edge] = addEdge(conn, []);
      if (edge) connect(edge);
    },
    [connect],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/hm-flow-node') as FlowNodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  /**
   * onBeforeDelete: intercept keyboard Delete/Backspace — filter out trigger nodes so they
   * can never be deleted via keyboard shortcut (guard: §F32-S01).
   */
  const onBeforeDelete = useCallback(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }: { nodes: Node[]; edges: Edge[] }) => {
      const deletable = nodesToDelete.filter((n) => n.type !== 'trigger');
      return { nodes: deletable, edges: edgesToDelete };
    },
    [],
  );

  /**
   * onNodesDelete: propagate confirmed deletions to the zustand store for persistence.
   * ReactFlow has already removed them from its internal state; we sync our store.
   */
  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      deleteNodes(deletedNodes.map((n) => n.id));
    },
    [deleteNodes],
  );

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={a11yNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        onInit={(inst) => {
          instanceRef.current = inst;
        }}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        // Delete/Backspace remove selected node (trigger guard via onBeforeDelete).
        // Em read-only (mobile) não há atalho de exclusão de grafo.
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        // a11y: nodes focáveis por Tab; setas reposicionam o node selecionado (md+).
        nodesFocusable
        // Mobile read-first: pan/zoom + seleção por toque, sem edição estrutural.
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        onSelectionChange={({ nodes: sel }) => select(sel[0]?.id ?? null)}
        onDrop={readOnly ? undefined : onDrop}
        onDragOver={
          readOnly
            ? undefined
            : (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
        }
        aria-label="Canvas do flow. Use Tab para focar os nós, setas para movê-los e Enter para selecionar e abrir o painel de edição."
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background className="!bg-surface-0" />
        <Controls className="!bg-surface-2 !text-text" />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas({ readOnly = false }: CanvasInnerProps = {}) {
  return <CanvasInner readOnly={readOnly} />;
}
