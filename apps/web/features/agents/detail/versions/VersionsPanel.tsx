'use client';

import { useMemo, useState } from 'react';
import { GitBranch, History, RotateCcw, Rocket, Trash2, X } from 'lucide-react';
import { Button, Card, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/feedback';
import { VersionDiff } from './VersionDiff';
import {
  useAgentVersionDiff,
  useAgentVersions,
  useCreateDraft,
  useDiscardDraft,
  usePublishVersion,
  useRollbackVersion,
} from './queries';
import type { PromptVersion, PromptVersionStatus } from './types';

/**
 * Aba de Versões do prompt do agente — "prompt como código" (F56-S31 / AUDITORIA §3.3).
 *
 * Trata o cérebro do agente como código: histórico append-only, publicação explícita
 * draft→live, diff visual e rollback 1-clique. Consome o versions router via `queries.ts`.
 * DS v2 — só tokens semânticos, zero hex.
 */

const STATUS_META: Record<PromptVersionStatus, { label: string; className: string }> = {
  live: { label: 'Ativa', className: 'bg-success/15 text-success' },
  draft: { label: 'Rascunho', className: 'bg-info/15 text-info' },
  archived: { label: 'Arquivada', className: 'bg-surface-3 text-text-low' },
};

function StatusBadge({ status }: { status: PromptVersionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 font-head text-xs font-medium',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

export function VersionsPanel({ agentId }: { agentId: string }) {
  const { toast } = useToast();
  const query = useAgentVersions(agentId);
  const versions = useMemo(() => query.data?.versions ?? [], [query.data]);

  const createDraft = useCreateDraft(agentId);
  const publish = usePublishVersion(agentId);
  const rollback = useRollbackVersion(agentId);
  const discard = useDiscardDraft(agentId);

  // Editor de novo rascunho.
  const [drafting, setDrafting] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftLabel, setDraftLabel] = useState('');

  // Diff: par (from, to) por número de versão.
  const [compare, setCompare] = useState<{ from: number; to: number } | null>(null);
  const diff = useAgentVersionDiff(agentId, compare?.from ?? null, compare?.to ?? null);

  const live = versions.find((v) => v.status === 'live') ?? null;

  function openDraft() {
    setDraftPrompt(live?.systemPrompt ?? '');
    setDraftLabel('');
    setDrafting(true);
  }

  function submitDraft() {
    const systemPrompt = draftPrompt.trim();
    if (systemPrompt.length === 0) {
      toast({ variant: 'warn', title: 'O prompt do rascunho não pode ficar vazio.' });
      return;
    }
    createDraft.mutate(
      { systemPrompt, label: draftLabel.trim() || null },
      {
        onSuccess: () => {
          toast({ variant: 'success', title: 'Rascunho criado.' });
          setDrafting(false);
        },
        onError: () => toast({ variant: 'error', title: 'Não foi possível criar o rascunho.' }),
      },
    );
  }

  function onPublish(v: PromptVersion) {
    publish.mutate(v.id, {
      onSuccess: () => toast({ variant: 'success', title: `v${v.version} publicada.` }),
      onError: () => toast({ variant: 'error', title: 'Falha ao publicar.' }),
    });
  }

  function onRollback(v: PromptVersion) {
    rollback.mutate(
      { versionId: v.id },
      {
        onSuccess: (data) =>
          toast({
            variant: 'success',
            title: `Restaurado v${v.version} como v${data.version.version}.`,
          }),
        onError: () => toast({ variant: 'error', title: 'Falha no rollback.' }),
      },
    );
  }

  function onDiscard(v: PromptVersion) {
    discard.mutate(v.id, {
      onSuccess: () => toast({ variant: 'success', title: 'Rascunho descartado.' }),
      onError: () => toast({ variant: 'error', title: 'Falha ao descartar.' }),
    });
  }

  function onCompare(v: PromptVersion) {
    // Compara a versão selecionada → live (ou a mais recente, se não houver live).
    const target = live ?? versions[0];
    if (!target || target.version === v.version) {
      toast({ variant: 'info', title: 'Nada para comparar.' });
      return;
    }
    const [from, to] =
      v.version < target.version ? [v.version, target.version] : [target.version, v.version];
    setCompare({ from, to });
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o histórico"
        reason="A conexão com a API falhou ou expirou."
        whatToDo="Verifique sua conexão e tente novamente."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho + ação principal */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-head text-lg font-semibold text-text">Versões do prompt</h2>
          <p className="font-body text-sm text-text-low">
            Histórico append-only. Publique explicitamente (rascunho → ativa), compare e reverta
            sem editar o agente ao vivo.
          </p>
        </div>
        <Button onClick={openDraft} disabled={drafting}>
          Novo rascunho
        </Button>
      </div>

      {/* Editor de rascunho */}
      {drafting && (
        <Card elevation={1} className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="font-head text-sm font-medium text-text">Novo rascunho</span>
            <button
              type="button"
              onClick={() => setDrafting(false)}
              aria-label="Fechar editor"
              className="rounded-sm p-1 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs text-text-low">Rótulo (opcional)</span>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="ex.: tom mais consultivo"
              maxLength={200}
              className="h-10 rounded-md border border-border bg-surface-inset px-3 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low/60 focus-visible:border-border-brand"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-body text-xs text-text-low">Prompt do sistema</span>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={10}
              maxLength={20000}
              className="resize-y rounded-md border border-border bg-surface-inset px-3 py-2 font-price text-sm leading-relaxed text-text outline-none transition-colors placeholder:text-text-low/60 focus-visible:border-border-brand"
              placeholder="Escreva o novo prompt do agente…"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDrafting(false)}>
              Cancelar
            </Button>
            <Button onClick={submitDraft} disabled={createDraft.isPending}>
              {createDraft.isPending ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
          </div>
        </Card>
      )}

      {/* Diff aberto */}
      {compare && (
        <Card elevation={1} className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-head text-sm font-medium text-text">
              <GitBranch className="h-4 w-4 text-text-mid" />
              Comparação
            </span>
            <button
              type="button"
              onClick={() => setCompare(null)}
              aria-label="Fechar comparação"
              className="rounded-sm p-1 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {diff.isLoading ? (
            <Skeleton className="h-40" />
          ) : diff.isError || !diff.data ? (
            <p className="font-body text-sm text-danger">Não foi possível carregar o diff.</p>
          ) : (
            <VersionDiff from={diff.data.from} to={diff.data.to} />
          )}
        </Card>
      )}

      {/* Histórico */}
      {versions.length === 0 ? (
        <EmptyState
          icon={History}
          title="Sem versões ainda"
          description="Cada edição do prompt registra uma versão aqui, com diff e rollback."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((v) => (
            <li key={v.id}>
              <Card
                elevation={1}
                className={cn(
                  'flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between',
                  v.status === 'live' && 'ring-1 ring-success/30',
                )}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-price text-sm font-semibold text-text">v{v.version}</span>
                    <StatusBadge status={v.status} />
                    {v.rolledBackFrom !== null && (
                      <span className="inline-flex items-center gap-1 font-body text-xs text-text-low">
                        <RotateCcw className="h-3 w-3" />
                        de v{v.rolledBackFrom}
                      </span>
                    )}
                  </div>
                  {v.label && <span className="font-body text-sm text-text-mid">{v.label}</span>}
                  <span className="font-body text-xs text-text-low">
                    {v.status === 'live'
                      ? `Publicada ${formatDateTime(v.publishedAt)}`
                      : `Criada ${formatDateTime(v.createdAt)}`}
                    {v.model ? ` · ${v.model}` : ''}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCompare(v)}
                    disabled={v.status === 'live' && versions.length < 2}
                  >
                    <GitBranch className="mr-1 h-3.5 w-3.5" />
                    Comparar
                  </Button>
                  {v.status === 'draft' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onPublish(v)}
                        disabled={publish.isPending}
                      >
                        <Rocket className="mr-1 h-3.5 w-3.5" />
                        Publicar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDiscard(v)}
                        disabled={discard.isPending}
                        aria-label={`Descartar rascunho v${v.version}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </>
                  )}
                  {v.status === 'archived' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onRollback(v)}
                      disabled={rollback.isPending}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Restaurar
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
