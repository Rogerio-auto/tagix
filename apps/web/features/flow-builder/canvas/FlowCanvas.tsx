'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { CANVAS_ARIA_LABELS, CANVAS_THEME } from './canvas-theme';

/**
 * Rótulo de SR por node (UX §2.10): tipo legível + nome configurado, se houver. As
 * instruções de teclado vêm da descrição do React Flow (`CANVAS_ARIA_LABELS`).
 */
function nodeAriaLabel(node: Node<Record<string, unknown>>): string {
  const kind = node.type as FlowNodeKind | undefined;
  const meta = kind ? NODE_CATALOG[kind] : undefined;
  const typeLabel = meta?.label ?? 'Nó';
  const rawName = node.data?.['label'] ?? node.data?.['name'];
  const name = typeof rawName === 'string' && rawName.trim() ? `: ${rawName.trim()}` : '';
  return `${typeLabel}${name}`;
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
 * Canvas ReactFlow (FLOW_BUILDER seção 9.1/9.2). DnD do palette cria node no ponto do drop;
 * edges conectam handles; seleção alimenta o inspector. O store (zustand) e a fonte de verdade.
 */
function CanvasInner({ readOnly = false }: CanvasInnerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useFlowEditor((s) => s.nodes);
  const edges = useFlowEditor((s) => s.edges);

  // Injeta `ariaLabel` por node sem mutar o store (fonte de verdade do zustand) e a classe
  // `group/node`: o casco do nó (NodeShell) pinta o anel de foco do invólucro do React Flow.
  const a11yNodes = useMemo<FlowEditorNode[]>(
    () => nodes.map((n) => ({ ...n, ariaLabel: nodeAriaLabel(n), className: 'group/node' })),
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
    <div ref={wrapperRef} className="h-full w-full" data-flow-canvas="">
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
        aria-label={
          readOnly
            ? 'Canvas do flow, somente leitura. Use Tab para focar os nós e Enter para ver as propriedades.'
            : 'Canvas do flow. Use Tab para focar os nós, setas para movê-los e Enter para selecionar e abrir o painel de edição.'
        }
        ariaLabelConfig={CANVAS_ARIA_LABELS}
        // Pele do DS 3.0: variáveis --xy-* apontando para os tokens (troca com o tema).
        style={CANVAS_THEME}
        fitView
        // Folga embaixo para o grafo enquadrado não nascer sob o minimapa e os controles.
        fitViewOptions={{ padding: readOnly ? 0.2 : { x: '64px', top: '48px', bottom: '136px' }, maxZoom: 1.1 }}
        minZoom={0.25}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} />
        {/* Sem o cadeado: em só leitura ele reabriria a edição estrutural. */}
        <Controls showInteractive={false} className="overflow-hidden rounded-sm border border-border" />
        {!readOnly && (
          <MiniMap
            pannable
            zoomable
            nodeBorderRadius={6}
            // Geometria (não cor): minimapa compacto para não disputar com o grafo.
            style={{ width: 168, height: 104 }}
            className="!rounded-sm border border-border"
          />
        )}
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas({ readOnly = false }: CanvasInnerProps = {}) {
  return <CanvasInner readOnly={readOnly} />;
}
