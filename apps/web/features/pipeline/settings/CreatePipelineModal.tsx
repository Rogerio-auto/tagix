'use client';

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Button, Input, Modal } from '@hm/ui';
import { useCreatePipeline } from '../board/queries';
import type { PipelineLimitError } from '../board/queries';

// Templates de pipeline pre-definidos (seed: real_estate + clinic)
const TEMPLATES = [
  {
    key: 'blank' as const,
    name: 'Em branco',
    description: 'Comece com uma pipeline vazia e adicione estagios manualmente.',
    stages: [] as string[],
  },
  {
    key: 'real_estate' as const,
    name: 'Funil Imobiliario',
    description: 'Captacao - Visita - Proposta - Analise - Fechamento',
    stages: ['Captacao', 'Visita agendada', 'Proposta enviada', 'Analise juridica', 'Fechamento'],
  },
  {
    key: 'clinic' as const,
    name: 'Funil Clinica',
    description: 'Primeiro contato - Consulta - Orcamento - Tratamento - Retorno',
    stages: ['Primeiro contato', 'Consulta agendada', 'Orcamento aprovado', 'Tratamento', 'Retorno'],
  },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]['key'];

export interface CreatePipelineModalProps {
  open: boolean;
  onClose: () => void;
  /** Chamado apos criar com sucesso, recebe o id da nova pipeline. */
  onCreated?: (pipelineId: string) => void;
}

/**
 * Modal de criacao de pipeline (F35-S01).
 * Exportado de settings/; reutilizado pelo Board (S03).
 * Trata 422 pipeline_limit_reached com banner inline (nao toast).
 */
export function CreatePipelineModal({ open, onClose, onCreated }: CreatePipelineModalProps) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TemplateKey>('blank');
  const [limitError, setLimitError] = useState<PipelineLimitError | null>(null);

  const createPipeline = useCreatePipeline();

  function reset() {
    setName('');
    setTemplate('blank');
    setLimitError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLimitError(null);

    try {
      const result = await createPipeline.mutateAsync({ name: trimmed });
      const newId = result.pipeline.id;

      // Instanciar stages do template (frontend faz 2 calls: create pipeline -> create stages)
      const selectedTemplate = TEMPLATES.find((t) => t.key === template);
      if (selectedTemplate && selectedTemplate.stages.length > 0) {
        for (let i = 0; i < selectedTemplate.stages.length; i++) {
          const stageName = selectedTemplate.stages[i];
          if (!stageName) continue;
          await fetch('/api/pipelines/' + newId + '/stages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: stageName, position: i }),
          });
        }
      }

      reset();
      onClose();
      onCreated?.(newId);
    } catch (err: unknown) {
      const body = (err as { body?: PipelineLimitError }).body;
      if (body?.error === 'pipeline_limit_reached') {
        setLimitError(body);
      }
    }
  }

  const isSubmitting = createPipeline.isPending;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nova pipeline"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-pipeline-form"
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Criando...' : 'Criar pipeline'}
          </Button>
        </>
      }
    >
      <form id="create-pipeline-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {limitError && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            Limite de {limitError.max} pipelines atingido. Exclua uma pipeline para criar outra.
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pipeline-name" className="text-sm font-medium text-text">
            Nome
          </label>
          <Input
            id="pipeline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Funil de Vendas"
            maxLength={160}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text">Template</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTemplate(t.key)}
                className={[
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors duration-150',
                  template === t.key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-surface-raised text-text hover:border-border-2',
                ].join(' ')}
              >
                <Layers className="size-4 shrink-0" />
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-xs text-text-low leading-tight">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
