'use client';

import { create } from 'zustand';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { EditorEdge, EditorNode } from '../services';
import type { FlowNodeKind } from '../shared/node-catalog';

export type FlowEditorNode = Node<Record<string, unknown>>;
export type FlowEditorEdge = Edge;

interface HistoryEntry {
  nodes: FlowEditorNode[];
  edges: FlowEditorEdge[];
}

interface FlowEditorState {
  nodes: FlowEditorNode[];
  edges: FlowEditorEdge[];
  selectedNodeId: string | null;
  dirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];

  load: (nodes: EditorNode[], edges: EditorEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  connect: (edge: FlowEditorEdge) => void;
  addNode: (kind: FlowNodeKind, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  select: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  toPersistable: () => { nodes: EditorNode[]; edges: EditorEdge[] };
}

const snapshot = (s: Pick<FlowEditorState, 'nodes' | 'edges'>): HistoryEntry => ({
  nodes: structuredClone(s.nodes),
  edges: structuredClone(s.edges),
});

let nodeSeq = 0;
const nextNodeId = (kind: string) => `${kind}-${Date.now()}-${(nodeSeq += 1)}`;

export const useFlowEditor = create<FlowEditorState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  past: [],
  future: [],

  load: (nodes, edges) =>
    set({
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
      dirty: false,
      past: [],
      future: [],
      selectedNodeId: null,
    }),

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), dirty: true })),

  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), dirty: true })),

  connect: (edge) =>
    set((s) => ({
      past: [...s.past, snapshot(s)],
      future: [],
      edges: [...s.edges, edge],
      dirty: true,
    })),

  addNode: (kind, position) =>
    set((s) => {
      const node: FlowEditorNode = { id: nextNodeId(kind), type: kind, position, data: {} };
      return { past: [...s.past, snapshot(s)], future: [], nodes: [...s.nodes, node], dirty: true };
    }),

  updateNodeData: (id, data) =>
    set((s) => ({
      past: [...s.past, snapshot(s)],
      future: [],
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
      dirty: true,
    })),

  select: (id) => set({ selectedNodeId: id }),

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(s), ...s.future],
        nodes: prev.nodes,
        edges: prev.edges,
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        past: [...s.past, snapshot(s)],
        future: s.future.slice(1),
        nodes: next.nodes,
        edges: next.edges,
        dirty: true,
      };
    }),

  markSaved: () => set({ dirty: false }),

  toPersistable: () => {
    const s = get();
    return {
      nodes: s.nodes.map((n) => ({
        id: n.id,
        type: (n.type ?? 'message') as EditorNode['type'],
        position: n.position,
        data: n.data ?? {},
      })),
      edges: s.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    };
  },
}));
