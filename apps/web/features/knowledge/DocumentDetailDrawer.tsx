'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Archive, RefreshCw } from 'lucide-react';
import { Button, Drawer, Input, Modal, SkeletonText, Switch, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { Sheet as MobileSheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { formatNumber } from '@/shared/lib/locale';
import {
  useArchiveKbDocument,
  useKbDocument,
  useReprocessKbDocument,
  useUpdateKbDocument,
} from './queries';
import { DocumentStatusBadge } from './DocumentStatusBadge';

/**
 * Drawer de detalhe/edição de um documento (UX §2.3): metadados (PATCH), preview dos
 * trechos gerados e ações (reprocessar/arquivar). Read+write gated por `canEdit`; em
 * empresa só leitura as escritas ficam `aria-disabled` com a explicação. Arquivar pede
 * confirmação (UX §2.9): o agente para de consultar o documento.
 */
export function DocumentDetailDrawer({
  documentId,
  canEdit,
  onClose,
}: {
  documentId: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const readOnly = useIsReadOnly();
  const detail = useKbDocument(documentId ?? undefined);
  const update = useUpdateKbDocument();
  const reprocess = useReprocessKbDocument();
  const archive = useArchiveKbDocument();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState(5);
  const [visibleToAgents, setVisibleToAgents] = useState(true);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Sincroniza o form quando o doc carrega/muda.
  useEffect(() => {
    const doc = detail.data?.document;
    if (doc) {
      setTitle(doc.title);
      setCategory(doc.category ?? '');
      setPriority(doc.priority);
      setVisibleToAgents(doc.visibleToAgents);
    }
  }, [detail.data?.document]);

  const handleError = (err: unknown, heading: string): void => {
    const message = err instanceof ApiError ? err.message : 'Tente novamente.';
    const ref = err instanceof ApiError ? err.ref : undefined;
    toast({ variant: 'error', title: heading, description: ref ? `${message} (ref ${ref})` : message });
  };

  const save = async (): Promise<void> => {
    if (!documentId || readOnly) return;
    try {
      await update.mutateAsync({
        id: documentId,
        patch: {
          title: title.trim(),
          category: category.trim() || null,
          priority,
          visibleToAgents,
        },
      });
      toast({ variant: 'success', title: 'Documento atualizado' });
    } catch (err) {
      handleError(err, 'Falha ao salvar');
    }
  };

  const doReprocess = async (): Promise<void> => {
    if (!documentId) return;
    try {
      await reprocess.mutateAsync(documentId);
      toast({ variant: 'success', title: 'Reprocessamento iniciado' });
    } catch (err) {
      handleError(err, 'Falha ao reprocessar');
    }
  };

  const doArchive = async (): Promise<void> => {
    if (!documentId) return;
    try {
      await archive.mutateAsync(documentId);
      toast({ variant: 'success', title: 'Documento arquivado' });
      setConfirmArchive(false);
      onClose();
    } catch (err) {
      handleError(err, 'Falha ao arquivar');
    }
  };

  const doc = detail.data?.document;
  const chunkCount = detail.data?.chunkCount ?? 0;

  const body: ReactNode = detail.isLoading ? (
    <SkeletonText lines={6} />
  ) : !doc ? (
    <p className="font-body text-sm text-text-mid">Documento não encontrado.</p>
  ) : (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <DocumentStatusBadge status={doc.status} />
        <span className="font-body text-sm text-text-low">
          <span className="font-mono tabular-nums text-text-mid">{formatNumber(chunkCount)}</span>{' '}
          {chunkCount === 1 ? 'trecho indexado' : 'trechos indexados'}
        </span>
      </div>

      {canEdit && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input
            label="Prioridade (0–10)"
            type="number"
            min={0}
            max={10}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="font-mono tabular-nums"
          />
          <div className="rounded-md border border-border bg-surface-2 px-3.5 py-3">
            <Switch
              checked={visibleToAgents}
              onCheckedChange={setVisibleToAgents}
              label="Visível para os agentes"
              description="Desligado, o documento fica guardado mas os agentes não o consultam."
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <ReadOnlyGuard align="start" className="w-full sm:w-auto">
              <Button type="submit" variant="primary" className="w-full sm:w-auto" loading={update.isPending}>
                Salvar
              </Button>
            </ReadOnlyGuard>
            <ReadOnlyGuard align="start" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                leftIcon={<RefreshCw className="size-4" aria-hidden />}
                loading={reprocess.isPending}
                onClick={() => void doReprocess()}
              >
                Reprocessar
              </Button>
            </ReadOnlyGuard>
            <ReadOnlyGuard className="w-full sm:ml-auto sm:w-auto">
              <Button
                variant="ghost"
                className="w-full sm:w-auto"
                leftIcon={<Archive className="size-4" aria-hidden />}
                onClick={() => setConfirmArchive(true)}
              >
                Arquivar
              </Button>
            </ReadOnlyGuard>
          </div>
        </form>
      )}

      <section aria-labelledby="kb-chunks" className="flex flex-col gap-3 border-t border-border pt-5">
        <h3
          id="kb-chunks"
          className="font-mono text-xs font-medium uppercase tracking-widest text-text-low"
        >
          Preview dos trechos
        </h3>
        {(detail.data?.chunks.length ?? 0) === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center font-body text-sm text-text-low">
            {doc.status === 'draft'
              ? 'Indexando… os trechos aparecem quando o processamento terminar.'
              : 'Nenhum trecho indexado.'}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.data?.chunks.map((chunk) => (
              <li key={chunk.id} className="rounded-md border border-border bg-surface-2 p-3.5">
                <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-xs tabular-nums text-text-low">
                  <span>#{formatNumber(chunk.chunkIndex + 1)}</span>
                  <span>{formatNumber(chunk.contentTokens)} tokens</span>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap font-body text-sm text-text-mid">
                  {chunk.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );

  const heading = doc?.title ?? 'Documento';
  const archiveDialog = (
    <Modal
      open={confirmArchive}
      onClose={() => setConfirmArchive(false)}
      title="Arquivar documento?"
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmArchive(false)} disabled={archive.isPending}>
            Manter
          </Button>
          <ReadOnlyGuard>
            <Button variant="danger" loading={archive.isPending} onClick={() => void doArchive()}>
              Arquivar
            </Button>
          </ReadOnlyGuard>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-sm border border-danger/25 bg-danger/10 text-danger"
        >
          <AlertTriangle className="size-5" />
        </span>
        <p className="font-body text-sm text-text-mid">
          <span className="font-bold text-text">{heading}</span> sai da base: os agentes deixam de
          consultá-lo nas conversas. O conteúdo fica guardado e pode ser reenviado depois.
        </p>
      </div>
    </Modal>
  );

  // Mobile: full-sheet (conteúdo denso, UX §2.3). Desktop: Drawer lateral do DS.
  if (isMobile) {
    return (
      <>
        <MobileSheet open={documentId !== null} onClose={onClose} variant="full" title={heading}>
          {body}
        </MobileSheet>
        {archiveDialog}
      </>
    );
  }

  return (
    <>
      <Drawer
        open={documentId !== null}
        onClose={onClose}
        title={heading}
        description={doc?.category ?? undefined}
        className="max-w-xl"
      >
        {body}
      </Drawer>
      {archiveDialog}
    </>
  );
}
