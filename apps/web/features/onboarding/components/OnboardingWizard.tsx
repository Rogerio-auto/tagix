'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { ErrorState } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import { WizardShell } from './WizardShell';
import { WizardStepper } from './WizardStepper';
import { SurveyStep } from './SurveyStep';
import { NicheStep } from './NicheStep';
import { suggestNiche } from '../niches';
import { useApplyNiche, useSaveSurvey } from '../queries';
import type { ApplyNicheResult, NicheKey, SurveyAnswers } from '../types';

type StepId = 'welcome' | 'survey' | 'niche';

const STEPS: ReadonlyArray<{ key: StepId; label: string }> = [
  { key: 'welcome', label: 'Boas-vindas' },
  { key: 'survey', label: 'Sobre você' },
  { key: 'niche', label: 'Seu nicho' },
];

export interface OnboardingWizardProps {
  open: boolean;
  /** Estado inicial vindo de `GET /state` (pré-preenche a pesquisa, se houver). */
  initialSurvey?: SurveyAnswers | null;
  /** Fecha o wizard sem aplicar (Esc/backdrop). Não reabre na sessão. */
  onDismiss: () => void;
  /** Chamado após aplicar o blueprint com sucesso. */
  onApplied: (result: ApplyNicheResult) => void;
}

/**
 * Wizard de first-run (ONBOARDING.md §3.2): boas-vindas → mini-pesquisa → escolher
 * e confirmar o nicho → aplicar o blueprint. Estado preservado entre passos (voltar
 * não perde dados). A pesquisa é salva ao avançar (`PUT /survey`); aplicar dispara
 * `POST /apply` com feedback de loading + toast e erro em 3 partes (UX §2.7/§2.11).
 */
export function OnboardingWizard({ open, initialSurvey, onDismiss, onApplied }: OnboardingWizardProps): ReactNode {
  const [stepIndex, setStepIndex] = useState(0);
  const [survey, setSurvey] = useState<SurveyAnswers>(() => initialSurvey ?? {});
  const [selectedNiche, setSelectedNiche] = useState<NicheKey | null>(null);
  const [applyError, setApplyError] = useState<ApiError | null>(null);

  const { toast } = useToast();
  const saveSurvey = useSaveSurvey();
  const applyNiche = useApplyNiche();

  const step = STEPS[stepIndex]?.key ?? 'welcome';
  const suggested = useMemo(() => suggestNiche(survey.goal), [survey.goal]);

  // `initialSurvey` chega de forma assíncrona (depois do GET /state). Enquanto o
  // usuário ainda está na tela de boas-vindas e não digitou nada, semeia a pesquisa
  // com o que já estava salvo — sem clobber se ele já começou a responder.
  useEffect(() => {
    if (!initialSurvey) return;
    if (stepIndex !== 0) return;
    setSurvey((prev) =>
      prev.businessType == null && prev.teamSize == null && prev.goal == null ? initialSurvey : prev,
    );
  }, [initialSurvey, stepIndex]);

  function goBack(): void {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function goToSurvey(): void {
    setStepIndex(1);
  }

  async function goToNiche(): Promise<void> {
    // Salva a pesquisa (best-effort): a API exige ao menos uma resposta. Se o
    // usuário não respondeu nada, pula o PUT e segue — a pesquisa é opcional.
    const hasAnswer = survey.businessType != null || survey.teamSize != null || survey.goal != null;
    if (hasAnswer) {
      try {
        await saveSurvey.mutateAsync(survey);
      } catch {
        // Não bloqueia o onboarding por falha na pesquisa — ela é acessória.
        toast({ variant: 'error', title: 'Não foi possível salvar suas respostas, mas você pode continuar.' });
      }
    }
    // Pré-seleciona a sugestão se o usuário ainda não escolheu.
    setSelectedNiche((prev) => prev ?? suggested);
    setStepIndex(2);
  }

  async function handleApply(): Promise<void> {
    if (!selectedNiche) return;
    setApplyError(null);
    try {
      const result = await applyNiche.mutateAsync({ niche: selectedNiche });
      toast({ variant: 'success', title: 'Tudo pronto! Seu espaço já vem configurado para o seu nicho.' });
      onApplied(result);
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError(0, 'Não conseguimos concluir a configuração agora.');
      setApplyError(apiErr);
      toast({ variant: 'error', title: 'Não foi possível aplicar o pacote do nicho.' });
    }
  }

  const header = (
    <div className="flex flex-col gap-4">
      <WizardStepper steps={STEPS} current={stepIndex} />
    </div>
  );

  const footer = renderFooter();

  return (
    <WizardShell open={open} onClose={onDismiss} ariaLabel="Configuração inicial da Leadium" header={header} footer={footer}>
      {step === 'welcome' && <WelcomeBody />}
      {step === 'survey' && (
        <SurveyStep
          value={survey}
          onChange={setSurvey}
          suggestedNiche={suggested}
        />
      )}
      {step === 'niche' && (
        <div className="flex flex-col gap-4">
          {applyError && (
            <ErrorState
              title="Não foi possível aplicar o pacote do nicho."
              reason={applyError.message}
              whatToDo="Verifique sua conexão e tente de novo. Se persistir, fale com o suporte."
              {...(applyError.ref ? { reference: applyError.ref } : {})}
            />
          )}
          <NicheStep selected={selectedNiche} suggested={suggested} onSelect={setSelectedNiche} />
        </div>
      )}
    </WizardShell>
  );

  function renderFooter(): ReactNode {
    if (step === 'welcome') {
      return (
        <>
          <span className="text-xs text-text-low">Leva menos de um minuto.</span>
          <Button variant="primary" onClick={goToSurvey} rightIcon={<ArrowRight className="size-4" aria-hidden />}>
            Começar
          </Button>
        </>
      );
    }
    if (step === 'survey') {
      return (
        <>
          <Button variant="ghost" onClick={goBack} leftIcon={<ArrowLeft className="size-4" aria-hidden />}>
            Voltar
          </Button>
          <Button
            variant="primary"
            loading={saveSurvey.isPending}
            onClick={() => void goToNiche()}
            rightIcon={<ArrowRight className="size-4" aria-hidden />}
          >
            Continuar
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="ghost" onClick={goBack} leftIcon={<ArrowLeft className="size-4" aria-hidden />}>
          Voltar
        </Button>
        <Button
          variant="primary"
          disabled={!selectedNiche}
          loading={applyNiche.isPending}
          onClick={() => void handleApply()}
        >
          {applyNiche.isPending ? 'Configurando…' : 'Configurar meu espaço'}
        </Button>
      </>
    );
  }
}

/** Tela de boas-vindas (anti-empty-state, UX §2.6). */
function WelcomeBody(): ReactNode {
  return (
    <div className="flex flex-col items-start gap-4">
      <span className="flex size-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Sparkles className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="font-head text-2xl font-semibold text-text">Bem-vindo à Leadium</h2>
        <p className="text-text-mid">
          Vamos deixar seu espaço pronto para o seu negócio. Em poucos passos criamos seu funil, seu
          agente de IA, etiquetas e fluxos — tudo já configurado para o seu nicho.
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm text-text-mid">
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          Responda 3 perguntas rápidas sobre o seu negócio.
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          Escolha o seu nicho e nós montamos o resto.
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          Comece a atender em minutos, não em dias.
        </li>
      </ul>
    </div>
  );
}
