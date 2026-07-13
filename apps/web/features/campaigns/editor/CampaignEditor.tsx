'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, Input, useToast } from '@hm/ui';
import { ErrorState } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useChannels } from '@/features/channels/queries';
import { parseRecipientsCsv } from './csv';
import { describeLoadError, describeSaveError } from './errors';
import {
  blankStep,
  emptyWizardState,
  stepsAreSafeToPersist,
  toStepsPayload,
  toWizardState,
} from './hydrate';
import { WizardSkeleton } from './WizardSkeleton';
import {
  useActivateCampaign,
  useCampaignDetail,
  useCreateCampaign,
  useSetSteps,
  useUpdateCampaign,
  useUploadRecipients,
  useValidateCampaign,
} from './queries';
import type {
  CampaignStatus,
  CampaignType,
  FollowupTrigger,
  SendWindowsConfig,
  ValidationResult,
  WizardState,
} from './types';

const TOTAL_STEPS = 6;
const STEP_LABELS = [
  'Básico',
  'Destinatários',
  'Mensagens',
  'Janelas + rate',
  'IA',
  'Revisão',
] as const;

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'rascunho',
  scheduled: 'agendada',
  running: 'em execução',
  paused: 'pausada',
  completed: 'concluída',
  cancelled: 'cancelada',
};

const TRIGGER_LABEL: Record<FollowupTrigger, string> = {
  on_reply: 'Quando responder',
  on_no_reply: 'Se não responder',
  on_delivered: 'Após entregar',
};

const COMMERCIAL_WINDOWS: SendWindowsConfig = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
};

/**
 * Wizard de campanha em 6 passos (CAMPAIGNS.md 4, 12.2).
 *
 * Modo edição (CAMP-05 / UX-02): hidrata o estado com `GET /api/campaigns/:id`
 * antes de renderizar (skeleton no carregamento, erro acionável na falha) e libera
 * a navegação direta entre os passos. Nunca emite `PUT /steps` — que é
 * delete+insert — com rascunho vazio/incompleto.
 *
 * UX aplicado: §2.7 (feedback imediato: skeleton + botão loading), §2.11 (erro em
 * 3 partes com retry), §2.9 (nada destrutivo sem guarda), §3.6 (skeleton no lugar
 * do layout final), §2.10 (trilha de passos navegável por teclado).
 */
export function CampaignEditor({
  campaignId: initialId,
}: {
  campaignId?: string;
}): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const channelsQuery = useChannels();

  const isEditing = Boolean(initialId);
  const detail = useCampaignDetail(initialId);

  const [campaignId, setCampaignId] = useState<string | null>(initialId ?? null);
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [state, setState] = useState<WizardState>(emptyWizardState);

  // Hidrata uma única vez por campanha: nunca por cima de edições em andamento
  // (um refetch em background não pode apagar o que o usuário já digitou).
  const [hydrated, setHydrated] = useState(!isEditing);
  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialId || !detail.data) return;
    if (hydratedIdRef.current === initialId) return;
    hydratedIdRef.current = initialId;
    setState(toWizardState(detail.data));
    setHydrated(true);
  }, [initialId, detail.data]);

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign(campaignId ?? '');
  const setSteps = useSetSteps(campaignId ?? '');
  const uploadRecipients = useUploadRecipients(campaignId ?? '');
  const validateCampaign = useValidateCampaign(campaignId ?? '');
  const activateCampaign = useActivateCampaign(campaignId ?? '');

  function patch(p: Partial<WizardState>): void {
    setState((s) => ({ ...s, ...p }));
  }

  const status = detail.data?.campaign.status;
  const followups = detail.data?.followups ?? [];
  // Só rascunho é editável (a API responde 409 nos demais) → não deixar o usuário
  // digitar num formulário que nunca vai salvar.
  const readOnly = isEditing && status !== undefined && status !== 'draft';

  const validRows = state.rows.filter((r) => r.valid && !r.duplicate);
  const channels = channelsQuery.data?.channels ?? [];

  /** Persiste o passo `index`. Retorna false se bloqueou (validação local ou erro da API). */
  async function persistStep(index: number): Promise<boolean> {
    if (readOnly) return false;
    try {
      if (index === 0) {
        if (!state.name.trim() || !state.channelId) {
          toast({ title: 'Preencha nome e canal', variant: 'error' });
          return false;
        }
        if (!campaignId) {
          const res = await createCampaign.mutateAsync({
            channelId: state.channelId,
            name: state.name,
            type: state.type,
          });
          setCampaignId(res.campaign.id);
        } else {
          await updateCampaign.mutateAsync({ name: state.name, type: state.type });
        }
      }
      if (index === 1 && campaignId && validRows.length > 0) {
        await uploadRecipients.mutateAsync({
          rows: validRows.map((r) => ({ phone: r.phone, name: r.name })),
          source: 'wizard_import',
          optInOnImport: state.optInOnImport,
        });
      }
      if (index === 2 && campaignId) {
        // Guarda de CAMP-05: `PUT /steps` é delete+insert. Rascunho incompleto
        // apagaria os steps reais da campanha.
        if (!stepsAreSafeToPersist(state.steps)) {
          toast({ title: 'Todo step precisa de um template', variant: 'error' });
          return false;
        }
        await setSteps.mutateAsync(toStepsPayload(state.steps));
      }
      if (index === 3 && campaignId) {
        await updateCampaign.mutateAsync({
          sendWindows: state.sendWindows,
          rateLimitPerMinute: state.rateLimitPerMinute,
        });
      }
      if (index === 4 && campaignId) {
        await updateCampaign.mutateAsync({ autoHandoffOnReply: state.autoHandoffOnReply });
        setValidation(await validateCampaign.mutateAsync());
      }
      return true;
    } catch (err) {
      toast({ title: describeSaveError(err), variant: 'error' });
      return false;
    }
  }

  async function persistAndNext(): Promise<void> {
    if (await persistStep(step)) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  /** Trilha de passos: voltar é livre; avançar salva o passo atual antes de pular. */
  async function goToStep(target: number): Promise<void> {
    if (target === step) return;
    if (target < step) {
      setStep(target);
      return;
    }
    if (!campaignId) {
      toast({ title: 'Salve o primeiro passo para navegar', variant: 'error' });
      return;
    }
    if (readOnly || (await persistStep(step))) setStep(target);
  }

  async function runValidation(): Promise<void> {
    if (!campaignId) return;
    try {
      setValidation(await validateCampaign.mutateAsync());
    } catch (err) {
      toast({ title: describeSaveError(err), variant: 'error' });
    }
  }

  async function activate(): Promise<void> {
    try {
      await activateCampaign.mutateAsync();
      toast({ title: 'Campanha ativada', variant: 'success' });
      router.push('/campaigns');
    } catch {
      toast({ title: 'Não foi possível ativar (verifique o checklist)', variant: 'error' });
    }
  }

  // Estado agregado de "salvando este passo" → spinner imediato no CTA (UX §2.7).
  const savingNext =
    createCampaign.isPending ||
    updateCampaign.isPending ||
    setSteps.isPending ||
    uploadRecipients.isPending ||
    validateCampaign.isPending;

  /* ── Hidratação: erro acionável e skeleton antes de qualquer campo ──────── */

  if (isEditing && detail.isError) {
    const copy = describeLoadError(detail.error);
    return (
      <div className="p-6">
        <ErrorState
          title={copy.title}
          reason={copy.reason}
          whatToDo={copy.whatToDo}
          {...(copy.reference ? { reference: copy.reference } : {})}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {copy.retryable ? (
                <Button
                  variant="secondary"
                  loading={detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  Tentar de novo
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => router.push('/campaigns')}>
                Voltar para campanhas
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (isEditing && !hydrated) return <WizardSkeleton steps={TOTAL_STEPS} />;

  const stepLabel = STEP_LABELS[step] ?? '';

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-head text-lg font-semibold text-text">
          {isEditing ? 'Editar campanha' : 'Nova campanha'}
        </h1>
        <p className="text-sm text-text-low">
          Passo {step + 1} de {TOTAL_STEPS} · {stepLabel}
        </p>
      </header>

      {readOnly && status ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn"
        >
          <span>
            Campanha {STATUS_LABEL[status]}: só rascunhos podem ser editados. Os campos abaixo
            estão em leitura.
          </span>
          {campaignId ? (
            <Link
              href={`/campaigns/${campaignId}`}
              className="touch-target inline-flex items-center rounded-md border border-warn/40 px-3 py-1.5 text-sm text-warn outline-none hover:bg-warn/10 focus-visible:shadow-glow-md"
            >
              Ver campanha
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Trilha de passos: em edição a campanha já existe → navegação direta (UX §2.10). */}
      <nav aria-label="Passos do wizard" className="flex gap-1">
        {STEP_LABELS.map((label, i) => {
          const tone =
            i === step ? 'bg-brand' : i < step ? 'bg-brand-soft' : 'bg-surface-3';
          return campaignId ? (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={`Passo ${i + 1}: ${label}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => void goToStep(i)}
              disabled={savingNext}
              className="group flex-1 rounded-pill py-2 outline-none focus-visible:shadow-glow-md disabled:cursor-not-allowed"
            >
              <span
                className={cn(
                  'block h-1 rounded-pill transition-colors',
                  tone,
                  i > step && 'group-hover:bg-border-2',
                )}
              />
            </button>
          ) : (
            <div key={label} className="flex-1 py-2" title={label}>
              <span className={cn('block h-1 rounded-pill', tone)} />
            </div>
          );
        })}
      </nav>

      <Card>
        <CardBody>
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Nome
                <Input
                  value={state.name}
                  disabled={readOnly}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Black Friday 2026"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Tipo
                <select
                  value={state.type}
                  disabled={readOnly}
                  onChange={(e) => patch({ type: e.target.value as CampaignType })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md disabled:opacity-60"
                >
                  <option value="broadcast">Broadcast</option>
                  <option value="drip">Drip</option>
                  <option value="triggered">Triggered</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Canal
                <select
                  value={state.channelId}
                  disabled={readOnly || isEditing}
                  onChange={(e) => patch({ channelId: e.target.value })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md disabled:opacity-60"
                >
                  <option value="">Selecione um canal</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {isEditing && !readOnly ? (
                <p className="text-xs text-text-low">
                  O canal não muda depois de criada: destinatários e entregas já estão vinculados a
                  ele.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              {isEditing ? (
                <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-mid">
                  Os destinatários já importados continuam nesta campanha. Colar um novo CSV{' '}
                  <strong className="font-medium text-text">adiciona</strong> contatos — nada é
                  removido aqui.
                </p>
              ) : null}
              <p className="text-sm text-text-mid">
                Cole o CSV (cabeçalho phone,name). Telefones em E.164.
              </p>
              <textarea
                rows={6}
                disabled={readOnly}
                onChange={(e) => patch({ rows: parseRecipientsCsv(e.target.value) })}
                className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus-visible:shadow-glow-md disabled:opacity-60"
              />
              <label className="flex items-center gap-2 text-sm text-text-mid">
                <input
                  type="checkbox"
                  checked={state.optInOnImport}
                  disabled={readOnly}
                  onChange={(e) => patch({ optInOnImport: e.target.checked })}
                />
                Registrar opt-in nesta importação
              </label>
              {state.rows.length > 0 ? (
                <div className="text-sm text-text-mid">
                  {validRows.length} válidos · {state.rows.filter((r) => !r.valid).length} inválidos
                  <ul className="mt-2 max-h-40 overflow-auto rounded-md border border-border">
                    {state.rows.slice(0, 10).map((r, i) => (
                      <li
                        key={r.phone + i}
                        className={cn(
                          'flex justify-between px-3 py-1 text-xs',
                          r.valid && !r.duplicate ? 'text-text' : 'text-danger',
                        )}
                      >
                        <span>{r.phone}</span>
                        <span>{r.duplicate ? 'duplicado' : r.valid ? 'ok' : 'inválido'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              {state.steps.map((s, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">Step {i + 1}</span>
                    {state.steps.length > 1 && !readOnly ? (
                      <button
                        type="button"
                        className="touch-target rounded-sm px-2 text-xs text-danger outline-none hover:underline focus-visible:shadow-glow-md"
                        onClick={() =>
                          patch({ steps: state.steps.filter((_, idx) => idx !== i) })
                        }
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                  <Input
                    value={s.templateName}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, templateName: e.target.value };
                      patch({ steps: next });
                    }}
                    placeholder="Template Meta (APPROVED)"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={String(s.delaySeconds)}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, delaySeconds: Number(e.target.value) || 0 };
                      patch({ steps: next });
                    }}
                    placeholder="Delay (segundos)"
                  />
                  <p className="text-xs text-text-low">
                    Idioma {s.languageCode}
                    {s.templateComponents.length > 0
                      ? ` · ${s.templateComponents.length} componente(s) preservado(s)`
                      : ''}
                  </p>
                </div>
              ))}
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ steps: [...state.steps, blankStep()] })}
                >
                  + Adicionar step
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  onClick={() => patch({ sendWindows: COMMERCIAL_WINDOWS })}
                >
                  Horário comercial (Seg-Sex 9-18)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  onClick={() => patch({ sendWindows: { enabled: false } })}
                >
                  24/7
                </Button>
              </div>
              <p className="text-sm text-text-mid">
                Janelas: {state.sendWindows.enabled ? 'horário comercial' : '24/7'}
                {state.sendWindows.enabled && state.sendWindows.windows?.length
                  ? ` · ${state.sendWindows.windows.length} faixa(s)`
                  : ''}
              </p>
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Rate limit (mensagens/minuto)
                <Input
                  type="number"
                  min={1}
                  value={String(state.rateLimitPerMinute)}
                  disabled={readOnly}
                  onChange={(e) => patch({ rateLimitPerMinute: Number(e.target.value) || 30 })}
                />
              </label>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm text-text-mid">
                <input
                  type="checkbox"
                  checked={state.autoHandoffOnReply}
                  disabled={readOnly}
                  onChange={(e) => patch({ autoHandoffOnReply: e.target.checked })}
                />
                Acionar IA quando o contato responder
              </label>
              <p className="text-xs text-text-low">Ao avançar, rodamos a validação pré-flight.</p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="flex flex-col gap-4">
              <h2 className="font-head text-base font-semibold text-text">Revisão + checklist</h2>
              {validation ? (
                <div className="flex flex-col gap-3">
                  <div
                    className={cn(
                      'rounded-md border px-3 py-2 text-sm',
                      validation.safe
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger',
                    )}
                  >
                    {validation.safe ? 'Pronta para ativar.' : 'Há bloqueios críticos.'}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Destinatários', String(validation.stats.recipients)],
                      ['Sem opt-in', String(validation.stats.recipientsWithoutOptIn)],
                      ['Steps', String(validation.stats.steps)],
                      ['Limite do tier', String(validation.stats.tierLimit)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2"
                      >
                        <dt className="text-xs text-text-low">{label}</dt>
                        <dd className="font-price text-sm text-text">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {validation.criticalIssues.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm text-danger">
                      {validation.criticalIssues.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm text-warn">
                      {validation.warnings.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-text-low">
                    Validação pré-flight ainda não executada nesta sessão.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!campaignId || validateCampaign.isPending}
                    loading={validateCampaign.isPending}
                    onClick={() => void runValidation()}
                  >
                    Rodar validação
                  </Button>
                </div>
              )}

              {followups.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-text">
                    Follow-ups configurados ({followups.length})
                  </h3>
                  <ul className="flex flex-col gap-1 rounded-md border border-border">
                    {followups.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-text-mid"
                      >
                        <span className="text-text">{TRIGGER_LABEL[f.triggerEvent]}</span>
                        <span className="font-mono">{f.templateName}</span>
                        <span>
                          {f.delayMinutes} min · {f.isActive ? 'ativo' : 'inativo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-low">
                    Preservados: a edição pelo wizard não altera follow-ups.
                  </p>
                </section>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* CTA da etapa. Em mobile fixa no rodapé (zona do polegar) com safe-area;
          em md+ acompanha o fluxo. Autosave já ocorre em `persistAndNext`. */}
      <div
        className={
          isMobile
            ? 'sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-surface px-6 pt-3 pb-safe-4'
            : 'flex items-center justify-between gap-3'
        }
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
        >
          Voltar
        </Button>
        {readOnly ? (
          <Button variant="secondary" size={isMobile ? 'md' : 'sm'} onClick={() => router.push('/campaigns')}>
            Fechar
          </Button>
        ) : step < TOTAL_STEPS - 1 ? (
          <Button
            variant="primary"
            size={isMobile ? 'md' : 'sm'}
            className={isMobile ? 'flex-1' : undefined}
            disabled={savingNext}
            loading={savingNext}
            onClick={() => void persistAndNext()}
          >
            Salvar e continuar
          </Button>
        ) : (
          <Button
            variant="primary"
            size={isMobile ? 'md' : 'sm'}
            className={isMobile ? 'flex-1' : undefined}
            disabled={!validation?.safe || activateCampaign.isPending}
            loading={activateCampaign.isPending}
            onClick={() => void activate()}
          >
            Ativar campanha
          </Button>
        )}
      </div>
    </div>
  );
}
