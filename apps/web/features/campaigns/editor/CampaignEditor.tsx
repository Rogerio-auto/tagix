'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, Input, useToast } from '@hm/ui';
import { useChannels } from '@/features/channels/queries';
import { parseRecipientsCsv, type CsvRow } from './csv';
import {
  useActivateCampaign,
  useCreateCampaign,
  useSetSteps,
  useUpdateCampaign,
  useUploadRecipients,
  useValidateCampaign,
  type SendWindowsConfig,
  type ValidationResult,
} from './queries';

type CampaignType = 'broadcast' | 'drip' | 'triggered';

interface StepDraft {
  templateName: string;
  languageCode: string;
  delaySeconds: number;
}

interface WizardState {
  name: string;
  type: CampaignType;
  channelId: string;
  rows: CsvRow[];
  optInOnImport: boolean;
  steps: StepDraft[];
  sendWindows: SendWindowsConfig;
  rateLimitPerMinute: number;
  autoHandoffOnReply: boolean;
}

const TOTAL_STEPS = 6;
const STEP_LABELS = [
  'Basico',
  'Destinatarios',
  'Mensagens',
  'Janelas + rate',
  'IA',
  'Revisao',
];

const COMMERCIAL_WINDOWS: SendWindowsConfig = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
};

/** Wizard de criacao de campanha em 6 steps (CAMPAIGNS.md 4, 12.2). */
export function CampaignEditor({
  campaignId: initialId,
}: {
  campaignId?: string;
}): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const channelsQuery = useChannels();
  const [campaignId, setCampaignId] = useState<string | null>(initialId ?? null);
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const [state, setState] = useState<WizardState>({
    name: '',
    type: 'broadcast',
    channelId: '',
    rows: [],
    optInOnImport: true,
    steps: [{ templateName: '', languageCode: 'pt_BR', delaySeconds: 0 }],
    sendWindows: { enabled: false },
    rateLimitPerMinute: 30,
    autoHandoffOnReply: true,
  });

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign(campaignId ?? '');
  const setSteps = useSetSteps(campaignId ?? '');
  const uploadRecipients = useUploadRecipients(campaignId ?? '');
  const validateCampaign = useValidateCampaign(campaignId ?? '');
  const activateCampaign = useActivateCampaign(campaignId ?? '');

  function patch(p: Partial<WizardState>): void {
    setState((s) => ({ ...s, ...p }));
  }

  const validRows = state.rows.filter((r) => r.valid && !r.duplicate);

  // Persiste o progresso ao avancar (cria/atualiza a campanha + steps + recipients).
  async function persistAndNext(): Promise<void> {
    try {
      if (step === 0) {
        if (!state.name.trim() || !state.channelId) {
          toast({ title: 'Preencha nome e canal', variant: 'error' });
          return;
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
      if (step === 1 && campaignId && validRows.length > 0) {
        await uploadRecipients.mutateAsync({
          rows: validRows.map((r) => ({ phone: r.phone, name: r.name })),
          source: 'wizard_import',
          optInOnImport: state.optInOnImport,
        });
      }
      if (step === 2 && campaignId) {
        if (state.steps.some((s) => !s.templateName.trim())) {
          toast({ title: 'Todo step precisa de um template', variant: 'error' });
          return;
        }
        await setSteps.mutateAsync(
          state.steps.map((s, i) => ({
            position: i,
            templateName: s.templateName,
            languageCode: s.languageCode,
            delaySeconds: s.delaySeconds,
          })),
        );
      }
      if (step === 3 && campaignId) {
        await updateCampaign.mutateAsync({
          sendWindows: state.sendWindows,
          rateLimitPerMinute: state.rateLimitPerMinute,
        });
      }
      if (step === 4 && campaignId) {
        await updateCampaign.mutateAsync({ autoHandoffOnReply: state.autoHandoffOnReply });
      }
      if (step === 4) {
        const result = await validateCampaign.mutateAsync();
        setValidation(result);
      }
      setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    } catch {
      toast({ title: 'Falha ao salvar o passo', variant: 'error' });
    }
  }

  async function activate(): Promise<void> {
    try {
      await activateCampaign.mutateAsync();
      toast({ title: 'Campanha ativada', variant: 'success' });
      router.push('/campaigns');
    } catch {
      toast({ title: 'Nao foi possivel ativar (verifique o checklist)', variant: 'error' });
    }
  }

  const channels = channelsQuery.data?.channels ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">
          {initialId ? 'Editar campanha' : 'Nova campanha'}
        </h1>
        <p className="text-sm text-text-low">
          Passo {step + 1} de {TOTAL_STEPS} · {STEP_LABELS[step]}
        </p>
      </header>

      <div className="flex gap-1">
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={'h-1 flex-1 rounded-full ' + (i <= step ? 'bg-brand' : 'bg-surface-3')}
          />
        ))}
      </div>

      <Card>
        <CardBody>
          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Nome
                <Input
                  value={state.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Black Friday 2026"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Tipo
                <select
                  value={state.type}
                  onChange={(e) => patch({ type: e.target.value as CampaignType })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
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
                  onChange={(e) => patch({ channelId: e.target.value })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
                >
                  <option value="">Selecione um canal</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-mid">
                Cole o CSV (cabecalho phone,name). Telefones em E.164.
              </p>
              <textarea
                rows={6}
                onChange={(e) => patch({ rows: parseRecipientsCsv(e.target.value) })}
                className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text"
              />
              <label className="flex items-center gap-2 text-sm text-text-mid">
                <input
                  type="checkbox"
                  checked={state.optInOnImport}
                  onChange={(e) => patch({ optInOnImport: e.target.checked })}
                />
                Registrar opt-in nesta importacao
              </label>
              {state.rows.length > 0 ? (
                <div className="text-sm text-text-mid">
                  {validRows.length} validos · {state.rows.filter((r) => !r.valid).length} invalidos
                  <ul className="mt-2 max-h-40 overflow-auto rounded-md border border-border">
                    {state.rows.slice(0, 10).map((r, i) => (
                      <li
                        key={r.phone + i}
                        className={'flex justify-between px-3 py-1 text-xs ' + (r.valid && !r.duplicate ? 'text-text' : 'text-danger')}
                      >
                        <span>{r.phone}</span>
                        <span>{r.duplicate ? 'duplicado' : r.valid ? 'ok' : 'invalido'}</span>
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
                    {state.steps.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs text-danger"
                        onClick={() => patch({ steps: state.steps.filter((_, idx) => idx !== i) })}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                  <Input
                    value={s.templateName}
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, templateName: e.target.value };
                      patch({ steps: next });
                    }}
                    placeholder="Template Meta (APPROVED)"
                  />
                  <Input
                    type="number"
                    value={String(s.delaySeconds)}
                    onChange={(e) => {
                      const next = [...state.steps];
                      next[i] = { ...s, delaySeconds: Number(e.target.value) || 0 };
                      patch({ steps: next });
                    }}
                    placeholder="Delay (segundos)"
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({
                    steps: [...state.steps, { templateName: '', languageCode: 'pt_BR', delaySeconds: 0 }],
                  })
                }
              >
                + Adicionar step
              </Button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => patch({ sendWindows: COMMERCIAL_WINDOWS })}>
                  Horario comercial (Seg-Sex 9-18)
                </Button>
                <Button variant="outline" size="sm" onClick={() => patch({ sendWindows: { enabled: false } })}>
                  24/7
                </Button>
              </div>
              <p className="text-sm text-text-mid">
                Janelas: {state.sendWindows.enabled ? 'horario comercial' : '24/7'}
              </p>
              <label className="flex flex-col gap-1 text-sm text-text-mid">
                Rate limit (mensagens/minuto)
                <Input
                  type="number"
                  value={String(state.rateLimitPerMinute)}
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
                  onChange={(e) => patch({ autoHandoffOnReply: e.target.checked })}
                />
                Acionar IA quando o contato responder
              </label>
              <p className="text-xs text-text-low">
                Ao avancar, rodamos a validacao pre-flight.
              </p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-base font-semibold text-text">Revisao + checklist</h2>
              {validation ? (
                <div className="flex flex-col gap-3">
                  <div
                    className={'rounded-md border px-3 py-2 text-sm ' + (validation.safe ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger')}
                  >
                    {validation.safe ? 'Pronta para ativar.' : 'Ha bloqueios criticos.'}
                  </div>
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
                <p className="text-sm text-text-low">Validacao nao executada.</p>
              )}
              <Button
                variant="primary"
                disabled={!validation?.safe || activateCampaign.isPending}
                onClick={() => void activate()}
              >
                Ativar campanha
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(s - 1, 0))}>
          Voltar
        </Button>
        {step < TOTAL_STEPS - 1 ? (
          <Button variant="primary" size="sm" onClick={() => void persistAndNext()}>
            Salvar e continuar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
