'use client';

import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { can } from '@hm/shared';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useKbDocuments } from './queries';
import { DocumentList } from './DocumentList';
import { UploadDocumentDrawer } from './UploadDocumentDrawer';
import { DocumentDetailDrawer } from './DocumentDetailDrawer';

/**
 * Tela de gestão da Knowledge Base (F3-S06). Lista documentos com status de
 * indexação quase-real (polling enquanto houver `draft`), upload via drawer,
 * detalhe/edição/preview via drawer. Página gated por `kb.edit` (defesa em
 * profundidade do guard de F3-S04).
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
          icon={BookOpen}
          title="Sem acesso à base de conhecimento"
          description="A gestão da base de conhecimento é restrita a administradores e supervisores."
        />
      </div>
    );
  }

  const uploadButton = (
    <Button
      variant="primary"
      leftIcon={<Plus className="size-4" aria-hidden />}
      onClick={() => setUploadOpen(true)}
    >
      Novo documento
    </Button>
  );

  return (
    <div>
      <PageHeader title="Conhecimento" actions={uploadButton} />

      {documents.isLoading ? (
        <SkeletonList rows={5} />
      ) : documents.isError ? (
        <ErrorState
          title="Não foi possível carregar a base de conhecimento"
          reason="A conexão com a API falhou ou expirou."
          whatToDo="Verifique sua conexão e tente novamente."
          action={
            <Button variant="secondary" onClick={() => void documents.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : !documents.data || documents.data.documents.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nenhum documento ainda"
          description="Envie documentos (markdown ou texto) para que seus agentes possam consultá-los nas conversas via RAG."
          action={uploadButton}
        />
      ) : (
        <DocumentList documents={documents.data.documents} onSelect={setSelectedId} />
      )}

      <UploadDocumentDrawer open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DocumentDetailDrawer
        documentId={selectedId}
        canEdit={canEdit}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
