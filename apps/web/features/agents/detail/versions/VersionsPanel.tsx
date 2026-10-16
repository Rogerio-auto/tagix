'use client';

import { useMemo, useRef, useState } from 'react';
import { GitBranch, History, Plus, RotateCcw, Rocket, Trash2, X } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Skeleton,
  StatusPill,
  useToast,
  type BadgeTone,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/locale';
import { Field, Textarea } from '../../wizard/fields';
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
 * Aba de Versões do prompt do agente — "prompt como código" (F56-S31 / AUDITORIA §3.3),
 * montada no detalhe e repintada no DS 3.0 na F72-S07.
 *
 * Histórico append-only, publicação explícita rascunho → ativa, diff visual e rollback.
 * UX: §2.7 skeleton e botões em loading; §2.9 descartar rascunho pede confirmação;
 * §2.11 erro em 3 partes. Escrita (novo rascunho, publicar, restaurar, descartar) só
 * para quem edita o agente e, em empresa só leitura, `aria-disabled` com a explicação.
 */

const STATUS_META: Record<PromptVersionStatus, { label: string; tone: BadgeTone }> = {
  live: { label: 'Ativa', tone: 'success' },
  draft: { label: 'Rascunho', tone: 'info' },
  archived: { label: 'Arquivada', tone: 'neutral' },
};

export function VersionsPanel({ agentId, canEdit = false }: { agentId: string; canEdit?: boolean }) {
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

  // Descartar é irreversível: confirmação com o foco no botão seguro (UX §2.9).
  const [toDiscard, setToDiscard] = useState<PromptVersion | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

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

  function confirmDiscard() {
    const v = toDiscard;
    if (!v) return;
    discard.mutate(v.id, {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Rascunho descartado.' });
        setToDiscard(null);
      },
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
      <div className="flex flex-col gap-3" aria-busy aria-label="Carregando versões">
        <Skeleton className="h-10 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
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
          <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho + ação principal */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-head text-lg font-medium text-text">Versões do prompt</h2>
          <p className="max-w-prose font-body text-sm text-text-low">
            Histórico que só cresce. Publique explicitamente (rascunho → ativa), compare e reverta
            sem editar o agente ao vivo.
          </p>
        </div>
        {canEdit ? (
          <ReadOnlyGuard>
            <Button
              variant="secondary"
              leftIcon={<Plus className="size-4" aria-hidden />}
              onClick={openDraft}
              disabled={drafting}
            >
              Novo rascunho
            </Button>
          </ReadOnlyGuard>
        ) : null}
      </div>

      {/* Editor de rascunho */}
      {drafting && (
        <Card elevation={1} className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-head text-base font-medium text-text">Novo rascunho</h3>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Fechar editor"
              icon={<X className="size-4" aria-hidden />}
              onClick={() => setDrafting(false)}
            />
          </div>
          <Input
            label="Rótulo (opcional)"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="ex.: tom mais consultivo"
            maxLength={200}
          />
          <Field id="draft-prompt" label="Prompt do sistema">
            <Textarea
              id="draft-prompt"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={10}
              maxLength={20000}
              className="resize-y font-mono leading-relaxed"
              placeholder="Escreva o novo prompt do agente…"
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDrafting(false)}>
              Cancelar
            </Button>
            <ReadOnlyGuard>
              <Button variant="primary" loading={createDraft.isPending} onClick={submitDraft}>
                Salvar rascunho
              </Button>
            </ReadOnlyGuard>
          </div>
        </Card>
      )}

      {/* Diff aberto */}
      {compare && (
        <Card elevation={1} className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-head text-base font-medium text-text">
              <GitBranch className="size-4 text-text-mid" aria-hidden />
              Comparação
            </h3>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Fechar comparação"
              icon={<X className="size-4" aria-hidden />}
              onClick={() => setCompare(null)}
            />
          </div>
          {diff.isLoading ? (
            <Skeleton className="h-40 rounded-md" />
          ) : diff.isError || !diff.data ? (
            <p role="alert" className="font-body text-sm text-danger">
              Não foi possível carregar o diff. Feche e tente comparar de novo.
            </p>
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
        <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {versions.map((v) => {
            const meta = STATUS_META[v.status];
            return (
              <li
                key={v.id}
                className={cn(
                  'flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
                  v.status === 'live' && 'shadow-[inset_2px_0_0_0_var(--success)]',
                )}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium tabular-nums text-text">v{v.version}</span>
                    <StatusPill tone={meta.tone} size="sm">
                      {meta.label}
                    </StatusPill>
                    {v.rolledBackFrom !== null && (
                      <span className="inline-flex items-center gap-1 font-body text-xs text-text-low">
                        <RotateCcw className="size-3" aria-hidden />
                        de <span className="font-mono tabular-nums">v{v.rolledBackFrom}</span>
                      </span>
                    )}
                  </div>
                  {v.label && <span className="font-body text-sm text-text-mid">{v.label}</span>}
                  <span className="font-body text-xs text-text-low">
                    {v.status === 'live' ? 'Publicada ' : 'Criada '}
                    <span className="font-mono tabular-nums">
                      {formatDateTime(v.status === 'live' ? v.publishedAt : v.createdAt)}
                    </span>
                    {v.model ? (
                      <>
                        {' · '}
                        <span className="font-mono">{v.model}</span>
                      </>
                    ) : null}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCompare(v)}
                    disabled={v.status === 'live' && versions.length < 2}
                    leftIcon={<GitBranch className="size-3.5" aria-hidden />}
                    aria-label={`Comparar v${v.version}`}
                  >
                    Comparar
                  </Button>
                  {canEdit && v.status === 'draft' && (
                    <>
                      <ReadOnlyGuard>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onPublish(v)}
                          loading={publish.isPending && publish.variables === v.id}
                          disabled={publish.isPending}
                          leftIcon={<Rocket className="size-3.5" aria-hidden />}
                          aria-label={`Publicar v${v.version}`}
                        >
                          Publicar
                        </Button>
                      </ReadOnlyGuard>
                      <ReadOnlyGuard>
                        <IconButton
                          variant="ghost"
                          size="sm"
                          aria-label={`Descartar rascunho v${v.version}`}
                          icon={<Trash2 className="size-3.5 text-danger" aria-hidden />}
                          onClick={() => setToDiscard(v)}
                        />
                      </ReadOnlyGuard>
                    </>
                  )}
                  {canEdit && v.status === 'archived' && (
                    <ReadOnlyGuard>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onRollback(v)}
                        loading={rollback.isPending && rollback.variables?.versionId === v.id}
                        disabled={rollback.isPending}
                        leftIcon={<RotateCcw className="size-3.5" aria-hidden />}
                        aria-label={`Restaurar v${v.version}`}
                      >
                        Restaurar
                      </Button>
                    </ReadOnlyGuard>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Modal
        open={toDiscard !== null}
        onClose={() => setToDiscard(null)}
        title="Descartar rascunho?"
        initialFocusRef={keepRef}
        description={
          toDiscard ? (
            <>
              O rascunho <span className="font-mono text-text">v{toDiscard.version}</span> sai do
              histórico. A versão ativa não muda. Isto não pode ser desfeito.
            </>
          ) : undefined
        }
        footer={
          <>
            <Button ref={keepRef} variant="ghost" onClick={() => setToDiscard(null)}>
              Manter rascunho
            </Button>
            <Button variant="danger" loading={discard.isPending} onClick={confirmDiscard}>
              Descartar
            </Button>
          </>
        }
      />
    </div>
  );
}
