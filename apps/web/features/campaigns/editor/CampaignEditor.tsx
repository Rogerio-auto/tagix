'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button, Card, CardBody, ErrorState, Input, Switch, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { browserTimeZone, MARKET_DEFAULT_TIMEZONE } from './delivery/timezone';
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

/**
 * Horário comercial (seg-sex, 9h-18h) no fuso de quem configura: o do navegador, com
 * o padrão do market pack como reserva. Calculado no clique (nunca no SSR, onde o
 * fuso seria o do servidor).
 */
function commercialWindows(): SendWindowsConfig {
  return {
    enabled: true,
    timezone: browserTimeZone(MARKET_DEFAULT_TIMEZONE),
    windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
  };
}

/** Campo nativo (select/textarea) no mesmo desenho do `Input` do DS 3.0. */
const controlClass =
  'w-full rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 ' +
  'focus:border-brand-text focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';

const labelClass = 'flex flex-col gap-1.5 font-body text-sm font-bold text-text-mid';

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
      <div>
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
  const invalidCount = state.rows.filter((r) => !r.valid).length;

  // Formulário em largura de leitura (~900px), alinhado à esquerda como o resto do app.
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={campaignId && isEditing ? `/campaigns/${campaignId}` : '/campaigns'}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm font-body text-sm text-text-low outline-none transition-colors duration-(--dur-fast) hover:text-text focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {isEditing ? 'Campanha' : 'Campanhas'}
        </Link>
        <header className="flex flex-col gap-1.5">
          <h1 className="font-head text-h4 text-text md:text-h3">
            {isEditing ? 'Editar campanha' : 'Nova campanha'}
          </h1>
          <p className="font-body text-small text-text-low">
            <span className="font-mono tabular-nums text-text-mid">
              Passo {step + 1} de {TOTAL_STEPS}
            </span>{' '}
            · {stepLabel}
          </p>
        </header>
      </div>

      {readOnly && status ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-text"
        >
          <span>
            Campanha {STATUS_LABEL[status]}: só rascunhos podem ser editados. Os campos abaixo
            estão em leitura.
          </span>
          {campaignId ? (
            <Link
              href={`/campaigns/${campaignId}`}
              className="touch-target inline-flex items-center rounded-sm border border-border-2 px-3 py-1.5 text-sm font-medium text-text outline-none transition-colors hover:bg-surface-2 focus-visible:focus-ring"
            >
              Ver campanha
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Trilha de passos: em edição a campanha já existe → navegação direta (UX §2.10). */}
      <nav aria-label="Passos da campanha">
        <ol className="flex gap-1.5">
          {STEP_LABELS.map((label, i) => {
            const bar = cn(
              'block h-1 rounded-pill transition-colors duration-(--dur-base) motion-reduce:transition-none',
              i === step ? 'bg-brand-text' : i < step ? 'bg-brand-text/40' : 'bg-surface-3',
            );
            const caption = cn(
              'mt-2 hidden truncate font-mono text-xs uppercase tracking-wider md:block',
              i === step ? 'text-text' : 'text-text-low',
            );
            return (
              <li key={label} className="min-w-0 flex-1">
                {campaignId ? (
                  <button
                    type="button"
                    aria-label={`Passo ${i + 1}: ${label}`}
                    aria-current={i === step ? 'step' : undefined}
                    onClick={() => void goToStep(i)}
                    disabled={savingNext}
                    className="group block w-full rounded-sm py-2 text-left outline-none focus-visible:focus-ring disabled:cursor-not-allowed"
                  >
                    <span className={cn(bar, i > step && 'group-hover:bg-border-2')} />
                    <span className={caption} aria-hidden>
                      {label}
                    </span>
                  </button>
                ) : (
                  <div className="py-2" aria-current={i === step ? 'step' : undefined}>
                    <span className={bar} />
                    <span className={caption}>{label}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <Card>
        <CardBody>
          {step === 0 ? (
            <div className="flex flex-col gap-5">
              <Input
                label="Nome"
                value={state.name}
                disabled={readOnly}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Black Friday 2026"
              />
              <label className={labelClass}>
                Tipo
                <select
                  value={state.type}
                  disabled={readOnly}
                  onChange={(e) => patch({ type: e.target.value as CampaignType })}
                  className={cn(controlClass, 'h-10')}
                >
                  <option value="broadcast">Disparo único</option>
                  <option value="drip">Sequência</option>
                  <option value="triggered">Por gatilho</option>
                </select>
              </label>
              <label className={labelClass}>
                Canal
                <select
                  value={state.channelId}
                  disabled={readOnly || isEditing}
                  onChange={(e) => patch({ channelId: e.target.value })}
                  className={cn(controlClass, 'h-10')}
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
            <div className="flex flex-col gap-4">
              {isEditing ? (
                <p className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-text-mid">
                  Os destinatários já importados continuam nesta campanha. Colar um novo CSV{' '}
                  <strong className="font-bold text-text">adiciona</strong> contatos: nada é
                  removido aqui.
                </p>
              ) : null}
              <label className={labelClass}>
                Destinatários (CSV)
                <span className="font-normal text-text-low">
                  Cabeçalho <span className="font-mono">phone,name</span>; telefones em E.164.
                </span>
                <textarea
                  rows={6}
                  disabled={readOnly}
                  spellCheck={false}
                  onChange={(e) => patch({ rows: parseRecipientsCsv(e.target.value) })}
                  className={cn(controlClass, 'py-2 font-mono')}
                />
              </label>
              <Switch
                checked={state.optInOnImport}
                disabled={readOnly}
                onCheckedChange={(next) => patch({ optInOnImport: next })}
                label="Registrar opt-in nesta importação"
              />
              {state.rows.length > 0 ? (
                <div className="flex flex-col gap-2 text-sm text-text-mid">
                  <p className="font-mono tabular-nums">
                    <span className="text-text">{formatNumber(validRows.length)}</span> válidos ·{' '}
                    <span className={invalidCount > 0 ? 'text-danger' : undefined}>
                      {formatNumber(invalidCount)}
                    </span>{' '}
                    inválidos
                  </p>
                  <ul className="max-h-40 divide-y divide-border overflow-auto rounded-sm border border-border">
                    {state.rows.slice(0, 10).map((r, i) => (
                      <li
                        key={r.phone + i}
                        className={cn(
                          'flex justify-between gap-3 px-3 py-1.5 text-xs',
                          r.valid && !r.duplicate ? 'text-text' : 'text-danger',
                        )}
                      >
                        <span className="font-mono tabular-nums">{r.phone}</span>
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
                <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
                      Mensagem {i + 1}
                    </span>
                    {state.steps.length > 1 && !readOnly ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remover mensagem ${i + 1}`}
                        onClick={() => patch({ steps: state.steps.filter((_, idx) => idx !== i) })}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    label="Template"
                    value={s.templateName}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, templateName: e.target.value };
                      patch({ steps: next });
                    }}
                    placeholder="Template Meta aprovado"
                  />
                  <Input
                    label="Espera antes de enviar (segundos)"
                    type="number"
                    min={0}
                    value={String(s.delaySeconds)}
                    disabled={readOnly}
                    className="font-mono tabular-nums"
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, delaySeconds: Number(e.target.value) || 0 };
                      patch({ steps: next });
                    }}
                  />
                  <p className="text-xs text-text-low">
                    Idioma <span className="font-mono">{s.languageCode}</span>
                    {s.templateComponents.length > 0 ? (
                      <>
                        {' · '}
                        <span className="font-mono tabular-nums">{formatNumber(s.templateComponents.length)}</span>{' '}
                        componente(s) preservado(s)
                      </>
                    ) : null}
                  </p>
                </div>
              ))}
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  leftIcon={<Plus className="size-4" aria-hidden />}
                  onClick={() => patch({ steps: [...state.steps, blankStep()] })}
                >
                  Adicionar mensagem
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-5">
              <div role="group" aria-label="Janela de envio" className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  aria-pressed={state.sendWindows.enabled}
                  onClick={() => patch({ sendWindows: commercialWindows() })}
                >
                  Horário comercial (seg-sex, 9h-18h)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  aria-pressed={!state.sendWindows.enabled}
                  onClick={() => patch({ sendWindows: { enabled: false } })}
                >
                  24/7
                </Button>
              </div>
              <p className="text-sm text-text-mid">
                Janelas: {state.sendWindows.enabled ? 'horário comercial' : '24/7'}
                {state.sendWindows.enabled && state.sendWindows.windows?.length ? (
                  <>
                    {' · '}
                    <span className="font-mono tabular-nums">{formatNumber(state.sendWindows.windows.length)}</span>{' '}
                    faixa(s)
                  </>
                ) : null}
                {state.sendWindows.enabled && state.sendWindows.timezone ? (
                  <>
                    {' · '}
                    <span className="font-mono">{state.sendWindows.timezone}</span>
                  </>
                ) : null}
              </p>
              <Input
                label="Ritmo (mensagens por minuto)"
                type="number"
                min={1}
                value={String(state.rateLimitPerMinute)}
                disabled={readOnly}
                className="font-mono tabular-nums"
                onChange={(e) => patch({ rateLimitPerMinute: Number(e.target.value) || 30 })}
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-3">
              <Switch
                checked={state.autoHandoffOnReply}
                disabled={readOnly}
                onCheckedChange={(next) => patch({ autoHandoffOnReply: next })}
                label="Acionar a IA quando o contato responder"
                description="Ao avançar, rodamos a validação antes do envio."
              />
            </div>
          ) : null}

          {step === 5 ? (
            <div className="flex flex-col gap-5">
              <h2 className="font-head text-lg font-medium text-text">Revisão</h2>
              {validation ? (
                <div className="flex flex-col gap-4">
                  <div
                    role="status"
                    className={cn(
                      'rounded-sm border px-3 py-2 text-sm font-medium',
                      validation.safe
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger',
                    )}
                  >
                    {validation.safe ? 'Pronta para ativar.' : 'Há bloqueios críticos.'}
                  </div>
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                    {(
                      [
                        ['Destinatários', validation.stats.recipients],
                        ['Sem opt-in', validation.stats.recipientsWithoutOptIn],
                        ['Mensagens', validation.stats.steps],
                        ['Limite do tier', validation.stats.tierLimit],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="flex flex-col gap-1.5 bg-surface px-4 py-3">
                        <dt className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">
                          {label}
                        </dt>
                        <dd className="font-mono text-lg font-medium tabular-nums text-text">
                          {formatNumber(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {validation.criticalIssues.length > 0 ? (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-danger">
                      {validation.criticalIssues.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-warn">
                      {validation.warnings.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-text-low">
                    A validação antes do envio ainda não rodou nesta sessão.
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
                  <h3 className="text-sm font-bold text-text">
                    Follow-ups configurados{' '}
                    <span className="font-mono tabular-nums text-text-low">
                      ({formatNumber(followups.length)})
                    </span>
                  </h3>
                  <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                    {followups.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-text-mid"
                      >
                        <span className="text-text">{TRIGGER_LABEL[f.triggerEvent]}</span>
                        <span className="font-mono">{f.templateName}</span>
                        <span>
                          <span className="font-mono tabular-nums">{formatNumber(f.delayMinutes)} min</span> ·{' '}
                          {f.isActive ? 'ativo' : 'inativo'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-low">
                    Preservados: a edição pelo assistente não altera follow-ups.
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
            ? 'sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 pt-3 pb-safe-4'
            : 'flex items-center justify-between gap-3'
        }
      >
        <Button
          variant="ghost"
          size={isMobile ? 'md' : 'sm'}
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
          <ReadOnlyGuard className={isMobile ? 'flex-1' : undefined}>
            <Button
              variant="primary"
              size={isMobile ? 'md' : 'sm'}
              className={isMobile ? 'w-full' : undefined}
              disabled={savingNext}
              loading={savingNext}
              onClick={() => void persistAndNext()}
            >
              Salvar e continuar
            </Button>
          </ReadOnlyGuard>
        ) : (
          <ReadOnlyGuard className={isMobile ? 'flex-1' : undefined}>
            <Button
              variant="primary"
              size={isMobile ? 'md' : 'sm'}
              className={isMobile ? 'w-full' : undefined}
              disabled={!validation?.safe || activateCampaign.isPending}
              loading={activateCampaign.isPending}
              onClick={() => void activate()}
            >
              Ativar campanha
            </Button>
          </ReadOnlyGuard>
        )}
      </div>
    </div>
  );
}
