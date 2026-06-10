'use client';

import { BookOpen } from 'lucide-react';
import { EmptyState } from '@/shared/components/feedback';

/**
 * Aba de Conhecimento — placeholder até F3 (Knowledge Base real: ingestão,
 * embeddings pgvector, retrieval). Mostra um empty state claro sinalizando que a
 * funcionalidade chega numa fase futura, sem CTA falso.
 */
export function KnowledgeTab() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Base de conhecimento em breve"
      description="A ingestão de documentos e o retrieval (RAG) para este agente chegam na fase F3. Por enquanto, o agente responde só com o prompt do sistema e suas tools."
    />
  );
}
