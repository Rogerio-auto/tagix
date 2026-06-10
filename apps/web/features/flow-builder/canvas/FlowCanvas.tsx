'use client';

import { useCallback, useRef } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useReactFlow,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFlowEditor } from '../hooks/useFlowEditor';
import { nodeTypes } from '../nodes/nodeTypes';
import type { FlowNodeKind } from '../shared/node-catalog';

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
        nodes={nodes}
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
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
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
