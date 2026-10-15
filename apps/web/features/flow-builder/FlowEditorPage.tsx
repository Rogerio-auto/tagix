'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { can } from '@hm/shared';
import { validateFlow, type FlowValidationIssue } from '@hm/flow-engine/validation';
import { Badge, Button, useToast } from '@hm/ui';
import { useIsReadOnly } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { CanvasSkeleton, ErrorState } from '@/shared/components/feedback';
import { lazyClient } from '@/shared/lib/lazy';
import { ApiError } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ExecutionsPanel } from './canvas/ExecutionsPanel';
import { NodePalette } from './canvas/NodePalette';
import { ToolbarTop } from './canvas/ToolbarTop';
import { EditableFlowName } from './canvas/EditableFlowName';
import { useFlow, usePublishFlow, useRenameFlow, useSaveFlow } from './hooks/useFlow';
import { useFlowEditor } from './hooks/useFlowEditor';
import { InspectorPanel } from './inspector/InspectorPanel';
import { MobileDegradationBanner } from './mobile/MobileDegradationBanner';
import { MobileLifecycleBar } from './mobile/MobileLifecycleBar';
import { MobileNodeList } from './mobile/MobileNodeList';
import { ValidationBanner } from './shared/validation-banner';
import { FlowHelpersAutoProvider } from './shared/helpers-context';
import type { FlowNodeKind } from './shared/node-catalog';
import { readTriggerConfig, readTriggerType } from './nodes/trigger/config';
import { FlowStatusBadge } from './list/FlowStatusBadge';
import { EDITOR_BLEED } from './shared/layout';

/**
 * Canvas @xyflow/react (engine de render + CSS + Background/Controls) carregado sob
 * demanda (F10-S10): o chunk pesado do canvas sai do First Load JS de `/flows/[id]`.
 * `ssr: false` — o ReactFlow é client-only (mede DOM, sem render no server). Enquanto
 * baixa, o `CanvasSkeleton` ocupa a área útil (UX §3.6 — sem tela branca). O
 * `ReactFlowProvider` e o store permanecem estáticos: o contexto existe antes do canvas
 * hidratar, então o boundary lazy não quebra os hooks de `useReactFlow`.
 */
const FlowCanvas = lazyClient<{ readOnly?: boolean }>(
  () => import('./canvas/FlowCanvas').then((m) => m.FlowCanvas),
  {
    loading: () => <CanvasSkeleton />,
    ssr: false,
  },
);

/** O alvo do atalho é um campo de texto (onde Ctrl+Z é do próprio campo). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Editor visual de um flow (F4-S10) no DS 3.0 (F72-S07). Canvas + palette + inspector +
 * toolbar + execuções.
 *
 * UX: §2.3 propriedades do nó em painel lateral (Sheet no celular); §2.7 salvar e publicar
 * com loading; §2.10 atalhos Ctrl/⌘+S (salvar), Ctrl/⌘+Z e Ctrl/⌘+Shift+Z (desfazer e
 * refazer fora de campos de texto); §2.11 erro em 3 partes com "Tentar de novo".
 * Só leitura (F71-S17): canvas sem edição estrutural, palette dá lugar à explicação,
 * propriedades travadas e salvar/publicar `aria-disabled` com a explicação.
 */
export function FlowEditorPage({ flowId }: { flowId: string }) {
  const role = useAuthStore((s) => s.auth?.role);
  const canPublish = role ? can(role, 'flow.publish') : false;
  const { isMobile } = useBreakpoint();
  const readOnly = useIsReadOnly();

  const { toast } = useToast();
  const flow = useFlow(flowId);
  const save = useSaveFlow(flowId);
  const publish = usePublishFlow(flowId);
  const rename = useRenameFlow(flowId);

  const handleRename = (name: string): void => {
    rename.mutate(name, {
      onSuccess: () => toast({ variant: 'success', title: 'Nome atualizado.' }),
      onError: (err) =>
        toast({
          variant: 'error',
          title: 'Não foi possível renomear.',
          description: err instanceof ApiError ? err.message : undefined,
        }),
    });
  };

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

  // Deriva triggerType/triggerConfig do node `trigger` para o PUT (a API válida ambos).
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
        message = 'O flow tem erros de validação.';
        setShowBanner(true);
      }
      toast({ variant: 'error', title: 'Falha ao publicar', description: message });
    }
  };

  // Atalhos de teclado (UX §2.10). A ref mantém o handler atual sem re-registrar o listener.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  shortcutRef.current = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      if (!readOnly && dirty && !save.isPending) void handleSave();
      return;
    }
    if (key === 'z' && !isTypingTarget(e.target)) {
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) redo();
      } else if (canUndo) {
        undo();
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => shortcutRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (flow.isLoading) {
    return (
      <div className={EDITOR_BLEED}>
        <CanvasSkeleton />
      </div>
    );
  }
  if (flow.isError || !flow.data) {
    return (
      <div className="p-6">
        <ErrorState
          title="Não foi possível carregar o flow"
          reason="A conexão com a API falhou ou o flow não existe mais."
          whatToDo="Tente de novo ou volte para a lista de flows."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="secondary" loading={flow.isFetching} onClick={() => void flow.refetch()}>
                Tentar de novo
              </Button>
              <Link
                href="/flows"
                className="inline-flex h-10 items-center rounded-sm px-4 text-sm font-bold text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
              >
                Voltar para flows
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  // Mobile (< md, F36-S11): read-first. Canvas pan/zoom sem edição estrutural; lista de nodes
  // navegável; inspector como full-sheet (no InspectorPanel); ciclo de vida no rodapé thumb-zone.
  if (isMobile) {
    return (
      <ReactFlowProvider>
        <FlowHelpersAutoProvider>
          <div className={cn(EDITOR_BLEED, 'flex flex-col')}>
            <header className="flex min-w-0 items-center gap-1.5 border-b border-border bg-surface px-2 py-2">
              <Link
                href="/flows"
                aria-label="Voltar para flows"
                className="flex size-10 shrink-0 items-center justify-center rounded-sm text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:focus-ring"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Link>
              <h1 className="min-w-0 flex-1">
                <EditableFlowName
                  name={flow.data.flow.name}
                  onRename={handleRename}
                  saving={rename.isPending}
                  readOnly={readOnly}
                />
              </h1>
              <FlowStatusBadge status={flow.data.flow.status} />
              <Badge tone={dirty ? 'warning' : 'neutral'} size="sm">
                {dirty ? 'Não salvo' : 'Salvo'}
              </Badge>
            </header>

            <MobileDegradationBanner />

            {showBanner && (
              <div className="border-b border-border bg-surface px-4 py-2">
                <ValidationBanner issues={issues} />
              </div>
            )}

            {/* Canvas read-first: ~55% da altura útil para pan/zoom, lista navegável abaixo. */}
            <div className="relative min-h-0 basis-[55%] border-b border-border">
              <FlowCanvas readOnly />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-border bg-surface px-4 py-2">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">Nós do flow</h2>
              </div>
              <MobileNodeList />
              <div className="border-t border-border px-4 py-4">
                <ExecutionsPanel flowId={flowId} />
              </div>
            </div>

            <MobileLifecycleBar
              flowId={flowId}
              status={flow.data.flow.status}
              dirty={dirty}
              saving={save.isPending}
              publishing={publish.isPending}
              canPublish={canPublish}
              readOnly={readOnly}
              onSave={() => void handleSave()}
              onPublish={() => void handlePublish()}
            />
          </div>

          {/* Inspector como full-sheet no mobile (controlado pelo node selecionado). */}
          <InspectorPanel readOnly={readOnly} />
        </FlowHelpersAutoProvider>
      </ReactFlowProvider>
    );
  }

  // Desktop (md+).
  return (
    <ReactFlowProvider>
      <FlowHelpersAutoProvider>
      <div className={cn(EDITOR_BLEED, 'flex flex-col bg-bg')}>
        <ToolbarTop
          flowName={flow.data.flow.name}
          status={flow.data.flow.status}
          readOnly={readOnly}
          dirty={dirty}
          saving={save.isPending}
          publishing={publish.isPending}
          renaming={rename.isPending}
          canUndo={canUndo}
          canRedo={canRedo}
          canPublish={canPublish}
          onSave={() => void handleSave()}
          onPublish={() => void handlePublish()}
          onRename={handleRename}
          onUndo={undo}
          onRedo={redo}
        />

        {showBanner && (
          <div className="border-b border-border bg-surface px-4 py-2">
            <ValidationBanner issues={issues} />
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <NodePalette readOnly={readOnly} />
          <div className="relative min-w-0 flex-1">
            <FlowCanvas readOnly={readOnly} />
          </div>
          <InspectorPanel readOnly={readOnly} idle={<ExecutionsPanel flowId={flowId} />} />
        </div>
      </div>
      </FlowHelpersAutoProvider>
    </ReactFlowProvider>
  );
}
