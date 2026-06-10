'use client';

import { api } from '@/shared/lib/api-client';
import type { FlowNodeKind } from './shared/node-catalog';

/** Node persistido (forma alinhada ao @xyflow/react Node + node.data opaco). */
export interface EditorNode {
  id: string;
  type: FlowNodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface EditorEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface FlowDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  nodes: EditorNode[];
  edges: EditorEdge[];
}

export interface FlowVersion {
  id: string;
  version: number;
  publishedAt: string;
}

export interface FlowExecutionSummary {
  id: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  currentNodeId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export const flowEditorService = {
  get: (id: string) => api.get<{ flow: FlowDetail; versions: FlowVersion[] }>(`/api/flows/${id}`),
  update: (
    id: string,
    patch: Partial<Pick<FlowDetail, 'name' | 'nodes' | 'edges' | 'triggerConfig'>>,
  ) => api.put<{ flow: FlowDetail }>(`/api/flows/${id}`, patch),
  publish: (id: string) => api.post<{ flow: FlowDetail }>(`/api/flows/${id}/publish`),
  executions: (id: string) =>
    api.get<{ executions: FlowExecutionSummary[] }>(`/api/flows/${id}/executions`),
  cancelExecution: (executionId: string) =>
    api.post<void>(`/api/flow-executions/${executionId}/cancel`),
};
