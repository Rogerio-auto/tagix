'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useReactFlow,
  type Connection,
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

/**
 * Canvas ReactFlow (FLOW_BUILDER secao 9.1/9.2). DnD do palette cria node no ponto do drop;
 * edges conectam handles; selecao alimenta o inspector. O store (zustand) e a fonte de verdade.
 */
function CanvasInner() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useFlowEditor((s) => s.nodes);
  const edges = useFlowEditor((s) => s.edges);

  // Injeta `ariaLabel` por node sem mutar o store (fonte de verdade do zustand).
  // ReactFlow expõe esse rótulo ao leitor de tela quando o node recebe foco.
  const a11yNodes = useMemo<FlowEditorNode[]>(
    () => nodes.map((n) => ({ ...n, ariaLabel: nodeAriaLabel(n) })),
    [nodes],
  );
  const onNodesChange = useFlowEditor((s) => s.onNodesChange);
  const onEdgesChange = useFlowEditor((s) => s.onEdgesChange);
  const connect = useFlowEditor((s) => s.connect);
  const addNode = useFlowEditor((s) => s.addNode);
  const select = useFlowEditor((s) => s.select);

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

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={a11yNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(inst) => {
          instanceRef.current = inst;
        }}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        // a11y: nodes focáveis por Tab; setas reposicionam o node selecionado
        // (paridade com o drag por mouse, §2.10). Enter/Espaço selecionam e
        // alimentam o inspector via onSelectionChange — corpo do node continua
        // sendo a ação primária (§2.1) e o drag por handle não regride (§2.2).
        nodesFocusable
        nodesDraggable
        elementsSelectable
        onSelectionChange={({ nodes: sel }) => select(sel[0]?.id ?? null)}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
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

export function FlowCanvas() {
  return <CanvasInner />;
}
