'use client';

import { useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { can } from '@hm/shared';
import { validateFlow, type FlowValidationIssue } from '@hm/flow-engine/validation';
import { useToast } from '@hm/ui';
import { CanvasSkeleton, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { lazyClient } from '@/shared/lib/lazy';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ExecutionsPanel } from './canvas/ExecutionsPanel';
import { NodePalette } from './canvas/NodePalette';
import { ToolbarTop } from './canvas/ToolbarTop';
import { useFlow, usePublishFlow, useSaveFlow } from './hooks/useFlow';
import { useFlowEditor } from './hooks/useFlowEditor';
import { InspectorPanel } from './inspector/InspectorPanel';
import { ValidationBanner } from './shared/validation-banner';
import { FlowHelpersAutoProvider } from './shared/helpers-context';
import type { FlowNodeKind } from './shared/node-catalog';
import { readTriggerConfig, readTriggerType } from './nodes/trigger/config';

/**
 * Canvas @xyflow/react (engine de render + CSS + Background/Controls) carregado sob
 * demanda (F10-S10): o chunk pesado do canvas sai do First Load JS de `/flows/[id]`.
 * `ssr: false` — o ReactFlow é client-only (mede DOM, sem render no server). Enquanto
 * baixa, o `CanvasSkeleton` ocupa a área útil (UX §3.6 — sem tela branca). O
 * `ReactFlowProvider` e o store permanecem estáticos: o contexto existe antes do canvas
 * hidratar, então o boundary lazy não quebra os hooks de `useReactFlow`.
 */
const FlowCanvas = lazyClient<Record<string, never>>(
  () => import('./canvas/FlowCanvas').then((m) => m.FlowCanvas),
  {
    loading: () => <CanvasSkeleton />,
    ssr: false,
  },
);

/** Editor visual de um flow (F4-S10). Canvas + palette + inspector + toolbar + execucoes. */
export function FlowEditorPage({ flowId }: { flowId: string }) {
  const role = useAuthStore((s) => s.auth?.role);
  const canPublish = role ? can(role, 'flow.publish') : false;

  const { toast } = useToast();
  const flow = useFlow(flowId);
  const save = useSaveFlow(flowId);
  const publish = usePublishFlow(flowId);

  const load = useFlowEditor((s) => s.load);
  const dirty = useFlowEditor((s) => s.dirty);
  const markSaved = useFlowEditor((s) => s.markSaved);
  const undo = useFlowEditor((s) => s.undo);
  const redo = useFlowEditor((s) => s.redo);
  const canUndo = useFlowEditor((s) => s.past.length > 0);
  const canRedo = useFlowEditor((s) => s.future.length > 0);
  const toPersistable = useFlowEditor((s) => s.toPersistable);
  const nodes = useFlowEditor((s) => s.nodes);
  const edges = useFlowEditor((s) => s.edges);

  const [showBanner, setShowBanner] = useState(false);

  // Carrega o flow no store ao montar / trocar de id.
  useEffect(() => {
    if (flow.data?.flow) {
      // Hidrata o node `trigger` com triggerType/triggerConfig das colunas do flow
      // (o editor persiste nodes/edges; o tipo/config vivem em colunas dedicadas).
      const { triggerType, triggerConfig } = flow.data.flow;
      const hydrated = flow.data.flow.nodes.map((n) =>
        n.type === 'trigger'
          ? { ...n, data: { ...(n.data ?? {}), triggerType, triggerConfig } }
          : n,
      );
      load(hydrated, flow.data.flow.edges);
    }
  }, [flow.data?.flow, load]);

  const issues: FlowValidationIssue[] = useMemo(() => {
    const persistable = { nodes, edges };
    return validateFlow({
      nodes: persistable.nodes.map((n) => ({
        id: n.id,
        type: String(n.type),
        data: n.data ?? {},
      })) as never,
      edges: persistable.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
      })) as never,
    }).issues as FlowValidationIssue[];
  }, [nodes, edges]);

  // Deriva triggerType/triggerConfig do node `trigger` para o PUT (a API valida ambos).
  const deriveTrigger = (
    persistableNodes: { type: FlowNodeKind; data: Record<string, unknown> }[],
  ): { triggerType: string; triggerConfig: Record<string, unknown> } | null => {
    const triggerNode = persistableNodes.find((n) => n.type === 'trigger');
    if (!triggerNode) return null;
    return {
      triggerType: readTriggerType(triggerNode.data),
      triggerConfig: readTriggerConfig(triggerNode.data),
    };
  };

  const handleSave = async () => {
    const { nodes: pNodes, edges: pEdges } = toPersistable();
    const trigger = deriveTrigger(pNodes);
    try {
      await save.mutateAsync({ nodes: pNodes, edges: pEdges, ...(trigger ?? {}) });
      markSaved();
      toast({ variant: 'success', title: 'Flow salvo' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao salvar', description: message });
    }
  };

  const handlePublish = async () => {
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      setShowBanner(true);
      toast({ variant: 'error', title: 'Corrija os erros antes de publicar' });
      return;
    }
    // Salva antes de publicar (a API publica o estado persistido).
    const { nodes: pNodes, edges: pEdges } = toPersistable();
    const trigger = deriveTrigger(pNodes);
    try {
      await save.mutateAsync({ nodes: pNodes, edges: pEdges, ...(trigger ?? {}) });
      markSaved();
      await publish.mutateAsync();
      toast({ variant: 'success', title: 'Flow publicado' });
      setShowBanner(false);
    } catch (err) {
      let message = err instanceof ApiError ? err.message : 'Tente novamente.';
      if (err instanceof ApiError && err.status === 422) {
        message = 'O flow tem erros de validacao.';
        setShowBanner(true);
      }
      toast({ variant: 'error', title: 'Falha ao publicar', description: message });
    }
  };

  if (flow.isLoading) {
    return (
      <div className="p-6">
        <SkeletonList rows={6} />
      </div>
    );
  }
  if (flow.isError || !flow.data) {
    return (
      <div className="p-6">
        <ErrorState
          title="Nao foi possivel carregar o flow"
          reason="A conexao com a API falhou ou o flow nao existe."
          whatToDo="Volte para a lista e tente novamente."
        />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <FlowHelpersAutoProvider>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <ToolbarTop
          flowName={flow.data.flow.name}
          dirty={dirty}
          saving={save.isPending}
          publishing={publish.isPending}
          canUndo={canUndo}
          canRedo={canRedo}
          canPublish={canPublish}
          onSave={() => void handleSave()}
          onPublish={() => void handlePublish()}
          onUndo={undo}
          onRedo={redo}
        />

        {showBanner && (
          <div className="border-b border-border-2 bg-surface-1 px-4 py-2">
            <ValidationBanner issues={issues} />
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <NodePalette />
          <div className="relative min-w-0 flex-1">
            <FlowCanvas />
            <div className="pointer-events-none absolute right-3 top-3 w-64">
              <div className="pointer-events-auto rounded-lg border border-border-2 bg-surface-1/95 p-3 backdrop-blur">
                <ExecutionsPanel flowId={flowId} />
              </div>
            </div>
          </div>
          <InspectorPanel />
        </div>
      </div>
      </FlowHelpersAutoProvider>
    </ReactFlowProvider>
  );
}
