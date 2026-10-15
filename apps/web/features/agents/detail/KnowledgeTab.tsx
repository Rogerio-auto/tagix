'use client';

import { useRouter } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { Button, Card } from '@hm/ui';

/**
 * Aba de Conhecimento do agente (F3-S06). A base de conhecimento é recurso
 * WORKSPACE-level (não per-agente): todos os documentos `visible_to_agents` ficam
 * disponíveis para o RAG de qualquer agente do workspace. Esta aba aponta para a
 * gestão central em `/knowledge` em vez de duplicar o CRUD aqui.
 */
export function KnowledgeTab() {
  const router = useRouter();
  return (
    <Card elevation={1} className="flex flex-col items-start gap-5 p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-brand-text"
        >
          <BookOpen className="size-5" />
        </span>
        <div>
          <h2 className="font-head text-lg font-medium text-text">
            Base de conhecimento do workspace
          </h2>
          <p className="font-body text-sm text-text-mid">
            Este agente consulta automaticamente (RAG) os documentos marcados como visíveis aos
            agentes. A base é compartilhada por todo o workspace.
          </p>
        </div>
      </div>
      <Button variant="secondary" onClick={() => router.push('/knowledge')}>
        Gerenciar base de conhecimento
      </Button>
    </Card>
  );
}
