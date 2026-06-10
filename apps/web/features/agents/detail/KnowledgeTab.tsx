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
    <Card elevation={1} className="flex flex-col items-start gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-surface-3 text-brand">
          <BookOpen className="size-5" aria-hidden />
        </span>
        <div>
          <h3 className="font-head text-base font-semibold text-text">
            Base de conhecimento do workspace
          </h3>
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
