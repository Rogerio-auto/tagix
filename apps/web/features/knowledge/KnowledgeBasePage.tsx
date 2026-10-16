'use client';

import { useState } from 'react';
import { BookOpen, Lock, Plus } from 'lucide-react';
import { can } from '@hm/shared';
import { AnchoredHelpHint, Button, EmptyState, ErrorState } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { formatNumber } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useKbDocuments } from './queries';
import { DocumentList } from './DocumentList';
import { UploadDocumentDrawer } from './UploadDocumentDrawer';
import { DocumentDetailDrawer } from './DocumentDetailDrawer';

/**
 * Base de conhecimento (F3-S06; DS 3.0 na F72-S07). Lista com status de indexação
 * quase-real (polling enquanto houver `draft`), upload e detalhe em Drawer (UX §2.3).
 * Página gated por `kb.edit` (defesa em profundidade do guard da API). Só leitura:
 * "Novo documento" fica `aria-disabled` com a explicação.
 */
export function KnowledgeBasePage() {
  const role = useAuthStore((s) => s.auth?.role);
  const canEdit = role ? can(role, 'kb.edit') : false;

  const documents = useKbDocuments();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Defesa em profundidade: sem kb.edit, a página não expõe a KB (o guard da API
  // já bloqueia, mas escondemos a UI também — UX coerente com a permissão).
  if (!canEdit) {
    return (
      <div>
        <PageHeader title="Conhecimento" />
        <EmptyState
          icon={Lock}
          title="Sem acesso à base de conhecimento"
          description="A gestão da base de conhecimento é restrita a administradores e supervisores."
        />
      </div>
    );
  }

  const uploadButton = (
    <ReadOnlyGuard>
      <Button
        variant="primary"
        leftIcon={<Plus className="size-4" aria-hidden />}
        onClick={() => setUploadOpen(true)}
      >
        Novo documento
      </Button>
    </ReadOnlyGuard>
  );

  const list = documents.data?.documents ?? [];
  const indexing = list.filter((d) => d.status === 'draft').length;
  const retry = (
    <Button variant="secondary" size="sm" onClick={() => void documents.refetch()}>
      Tentar de novo
    </Button>
  );
  const errorCopy = {
    title: 'Não foi possível carregar a base de conhecimento',
    reason: 'A conexão com a API falhou ou expirou.',
    whatToDo: 'Verifique sua conexão e tente novamente.',
    action: retry,
  };
  const emptyCopy = {
    icon: BookOpen,
    title: 'Nenhum documento ainda',
    description:
      'Envie documentos (markdown ou texto) para que seus agentes possam consultá-los nas conversas.',
  };

  return (
    <div>
      <PageHeader
        title="Conhecimento"
        description={
          documents.data ? (
            <span>
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(list.length)}</span>{' '}
              {list.length === 1 ? 'documento' : 'documentos'}
              {indexing > 0 && (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums text-text-mid">{formatNumber(indexing)}</span>{' '}
                  em indexação
                </>
              )}
            </span>
          ) : (
            'O que os agentes consultam para responder nas conversas.'
          )
        }
        helpSlot={<AnchoredHelpHint anchorKey="knowledge.list" />}
        actions={uploadButton}
      />

      <DocumentList
        documents={list}
        selectedId={selectedId}
        onSelect={setSelectedId}
        loading={documents.isLoading}
        error={documents.isError ? <ErrorState {...errorCopy} /> : undefined}
        errorCopy={documents.isError ? errorCopy : null}
        empty={<EmptyState {...emptyCopy} action={uploadButton} />}
        emptyCopy={{ ...emptyCopy, action: uploadButton }}
      />

      <UploadDocumentDrawer open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DocumentDetailDrawer
        documentId={selectedId}
        canEdit={canEdit}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
