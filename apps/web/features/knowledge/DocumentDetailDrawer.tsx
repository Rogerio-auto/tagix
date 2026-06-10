'use client';

import { useEffect, useState } from 'react';
import { Archive, RefreshCw } from 'lucide-react';
import { Button, Input, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/help/Sheet';
import { SkeletonList } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import {
  useArchiveKbDocument,
  useKbDocument,
  useReprocessKbDocument,
  useUpdateKbDocument,
} from './queries';
import { DocumentStatusBadge } from './DocumentStatusBadge';

/**
 * Drawer de detalhe/edição de um documento: metadados (PATCH), preview dos
 * chunks gerados e ações (reprocessar/arquivar). Read+write gated por `canEdit`
 * (o caller só abre com kb.edit; aqui é defesa em profundidade na UI).
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
  const detail = useKbDocument(documentId ?? undefined);
  const update = useUpdateKbDocument();
  const reprocess = useReprocessKbDocument();
  const archive = useArchiveKbDocument();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState(5);
  const [visibleToAgents, setVisibleToAgents] = useState(true);

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

  const handleError = (err: unknown, title: string) => {
    const message = err instanceof ApiError ? err.message : 'Tente novamente.';
    const ref = err instanceof ApiError ? err.ref : undefined;
    toast({ variant: 'error', title, description: ref ? `${message} (ref ${ref})` : message });
  };

  const save = async () => {
    if (!documentId) return;
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

  const doReprocess = async () => {
    if (!documentId) return;
    try {
      await reprocess.mutateAsync(documentId);
      toast({ variant: 'success', title: 'Reprocessamento iniciado' });
    } catch (err) {
      handleError(err, 'Falha ao reprocessar');
    }
  };

  const doArchive = async () => {
    if (!documentId) return;
    try {
      await archive.mutateAsync(documentId);
      toast({ variant: 'success', title: 'Documento arquivado' });
      onClose();
    } catch (err) {
      handleError(err, 'Falha ao arquivar');
    }
  };

  const doc = detail.data?.document;

  return (
    <Sheet
      open={documentId !== null}
      onClose={onClose}
      title={doc?.title ?? 'Documento'}
      widthClass="w-[560px]"
    >
      {detail.isLoading ? (
        <SkeletonList rows={5} />
      ) : !doc ? (
        <p className="font-body text-sm text-text-mid">Documento não encontrado.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <DocumentStatusBadge status={doc.status} />
            <span className="font-body text-xs text-text-low">
              {detail.data?.chunkCount ?? 0} trecho(s) indexado(s)
            </span>
          </div>

          {canEdit && (
            <div className="flex flex-col gap-4">
              <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Input
                label="Categoria"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <Input
                label="Prioridade (0–10)"
                type="number"
                min={0}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
              <label className="flex items-center gap-2 font-head text-sm text-text-mid">
                <input
                  type="checkbox"
                  checked={visibleToAgents}
                  onChange={(e) => setVisibleToAgents(e.target.checked)}
                  className="size-4 accent-brand"
                />
                Visível para os agentes
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={update.isPending} onClick={() => void save()}>
                  Salvar
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<RefreshCw className="size-4" aria-hidden />}
                  loading={reprocess.isPending}
                  onClick={() => void doReprocess()}
                >
                  Reprocessar
                </Button>
                <Button
                  variant="ghost"
                  leftIcon={<Archive className="size-4" aria-hidden />}
                  loading={archive.isPending}
                  onClick={() => void doArchive()}
                >
                  Arquivar
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="font-head text-sm font-semibold text-text">Preview dos trechos</h3>
            {(detail.data?.chunks.length ?? 0) === 0 ? (
              <p className="font-body text-sm text-text-low">
                {doc.status === 'draft'
                  ? 'Indexando… os trechos aparecem quando o processamento terminar.'
                  : 'Nenhum trecho indexado.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.data?.chunks.map((chunk) => (
                  <li
                    key={chunk.id}
                    className="rounded-sm border border-border-2 bg-surface-2 p-3"
                  >
                    <div className="mb-1 font-body text-xs text-text-low">
                      Trecho #{chunk.chunkIndex + 1} · {chunk.contentTokens} tokens
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap font-body text-sm text-text-mid">
                      {chunk.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
