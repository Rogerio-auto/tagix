'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { DepartmentsField } from '../DepartmentsField';
import {
  useAgentModels,
  useAgentTemplates,
  useCreateAgent,
} from '../queries';
import type {
  AgentDepartmentLink,
  AgentTemplate,
  CreateAgentInput,
  TemplateAnswerValue,
  TemplateQuestion,
} from '../types';
import { createAgentSchema } from '../types';
import { ModelStep } from './ModelStep';
import { QuestionsStep } from './QuestionsStep';
import { Stepper } from './Stepper';
import { TemplateStep } from './TemplateStep';

export interface AgentCreationWizardProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = ['Template', 'Detalhes', 'Modelo', 'Departamentos'] as const;
type StepIndex = 0 | 1 | 2 | 3;
const LAST_STEP: StepIndex = 3;

/** Uma resposta está "vazia" (para validar `required`). */
function isEmptyAnswer(value: TemplateAnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return false; // boolean false é resposta válida
}

/**
 * Wizard de criação de agente guiado por template (UX §2.3 — multi-step num
 * único painel/Modal, sem modais aninhados).
 *
 * Passos:
 *  1. Template — escolhe o ponto de partida (`GET /api/agents/templates`).
 *  2. Detalhes — nome do agente (RHF-like controlado + Zod) + respostas às
 *     `agent_template_questions` (validação dinâmica de `required`).
 *  3. Modelo — picker filtrado pela policy (`GET /api/agents/models`); cai no
 *     `defaultModel` do template quando o catálogo não está disponível.
 *
 * Submit: `POST /api/agents` com `{ name, templateId, model?, answers }`.
 */
export function AgentCreationWizard({ open, onClose }: AgentCreationWizardProps) {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const templatesQuery = useAgentTemplates(open);
  const modelsQuery = useAgentModels(open);
  const create = useCreateAgent();

  const [step, setStep] = useState<StepIndex>(0);
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, TemplateAnswerValue>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [model, setModel] = useState<string>();
  const [departments, setDepartments] = useState<AgentDepartmentLink[]>([]);

  const templates = templatesQuery.data ?? [];
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const questions: TemplateQuestion[] = template?.questions ?? [];

  const reset = () => {
    setStep(0);
    setTemplate(null);
    setName('');
    setNameError(undefined);
    setAnswers({});
    setAnswerErrors({});
    setModel(undefined);
    setDepartments([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickTemplate = (tpl: AgentTemplate) => {
    setTemplate(tpl);
    setAnswers({});
    setAnswerErrors({});
    setModel(undefined);
    setStep(1);
  };

  const setAnswer = (key: string, value: TemplateAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setAnswerErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Valida o passo de detalhes (nome via Zod + required answers dinâmicas). */
  const validateDetails = (): boolean => {
    let ok = true;

    // Nome: reusa o schema Zod compartilhado (campo fixo do payload).
    const nameResult = createAgentSchema.shape.name.safeParse(name);
    if (!nameResult.success) {
      setNameError(nameResult.error.issues[0]?.message ?? 'Nome inválido');
      ok = false;
    } else {
      setNameError(undefined);
    }

    const errs: Record<string, string> = {};
    for (const q of questions) {
      if (q.required && isEmptyAnswer(answers[q.key])) {
        errs[q.key] = 'Campo obrigatório';
        ok = false;
      }
    }
    setAnswerErrors(errs);
    return ok;
  };

  const goNext = () => {
    if (step === 1 && !validateDetails()) return;
    setStep((s) => (Math.min(s + 1, LAST_STEP) as StepIndex));
  };

  const goBack = () => setStep((s) => (Math.max(s - 1, 0) as StepIndex));

  const submit = async () => {
    if (!template) return;
    if (!validateDetails()) {
      setStep(1);
      return;
    }

    // Só envia answers não-vazias (chaveadas por question.key).
    const payloadAnswers: Record<string, TemplateAnswerValue> = {};
    for (const q of questions) {
      const value = answers[q.key];
      if (!isEmptyAnswer(value) && value !== undefined) payloadAnswers[q.key] = value;
    }

    const input: CreateAgentInput = {
      name: name.trim(),
      templateId: template.id,
      ...(model ? { model } : {}),
      ...(Object.keys(payloadAnswers).length > 0 ? { answers: payloadAnswers } : {}),
      ...(departments.length > 0 ? { departments } : {}),
    };

    try {
      const { agent } = await create.mutateAsync(input);
      toast({ variant: 'success', title: 'Agente criado', description: agent.name });
      handleClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao criar o agente',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    }
  };

  const title =
    step === 0
      ? 'Criar agente'
      : `Criar agente${template ? ` · ${template.name}` : ''}`;

  // 1 grupo por view (UX §2.8) — o Stepper marca o progresso; o corpo abaixo é
  // o passo atual. Idêntico em mobile e desktop, só muda a casca (Sheet/Modal).
  const body: ReactNode = (
    <div className="flex flex-col gap-5">
      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <TemplateStep
          templates={templates}
          loading={templatesQuery.isLoading}
          selectedId={template?.id ?? null}
          onSelect={pickTemplate}
        />
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <Input
            label="Nome do agente *"
            value={name}
            error={nameError}
            placeholder="Ex.: Vendas WhatsApp"
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(undefined);
            }}
          />
          <QuestionsStep
            questions={questions}
            values={answers}
            errors={answerErrors}
            onChange={setAnswer}
          />
        </div>
      )}

      {step === 2 && (
        <ModelStep
          models={models}
          loading={modelsQuery.isLoading}
          defaultModel={template?.defaultModel ?? 'Modelo padrão'}
          selected={model}
          onSelect={setModel}
        />
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="font-body text-sm text-text-mid">
            Em quais departamentos este agente atende? Marque um como{' '}
            <span className="font-medium text-text">agente de entrada</span> para que ele receba a
            primeira mensagem. Opcional — você pode configurar depois.
          </p>
          <DepartmentsField value={departments} onChange={setDepartments} />
        </div>
      )}
    </div>
  );

  // Navegação entre passos. No desktop fica logo abaixo do corpo (no Modal); no
  // mobile vai para o `footer` fixo do Sheet, na zona do polegar (CTA fixo — §2.8).
  const navInline = !isMobile;
  const nav: ReactNode = (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        navInline && 'mt-1 border-t border-border-2 pt-4',
      )}
    >
      {step > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="touch-target"
          leftIcon={<ArrowLeft className="size-4" aria-hidden />}
          onClick={goBack}
        >
          Voltar
        </Button>
      ) : (
        <span />
      )}

      {step < LAST_STEP ? (
        <Button
          variant="primary"
          disabled={step === 0 ? !template : false}
          rightIcon={<ArrowRight className="size-4" aria-hidden />}
          onClick={goNext}
        >
          Continuar
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={create.isPending}
          leftIcon={<Check className="size-4" aria-hidden />}
          onClick={() => void submit()}
        >
          Criar agente
        </Button>
      )}
    </div>
  );

  // Mobile: full-sheet com CTA fixo no rodapé (thumb-first). Desktop: inalterado.
  if (isMobile) {
    return (
      <Sheet open={open} onClose={handleClose} variant="full" title={title} footer={nav}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={title} className="max-w-xl">
      <div className="flex flex-col gap-5">
        {body}
        {nav}
      </div>
    </Modal>
  );
}
