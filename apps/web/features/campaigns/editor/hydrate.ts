/**
 * Hidratacao do wizard (CAMP-05 / UX-02): `GET /api/campaigns/:id` → `WizardState`.
 *
 * Logica pura, sem React, para ser testavel isolada. Regra de ouro: **nunca
 * sobrescrever o que veio do servidor com defaults** — o que nao tem UI ainda
 * (templateComponents, stopOnReply, idioma) trafega intacto de volta no PUT,
 * porque `PUT /steps` e delete+insert e apagaria o que nao for reenviado.
 */
import type {
  CampaignDetail,
  CampaignStepInput,
  CampaignStepRecord,
  CampaignType,
  SendWindowsConfig,
  StepDraft,
  WizardState,
} from './types';

const CAMPAIGN_TYPES: readonly CampaignType[] = ['broadcast', 'drip', 'triggered'];
const DEFAULT_LANGUAGE = 'pt_BR';
const DEFAULT_RATE_LIMIT = 30;

/** Step em branco (o wizard sempre mostra pelo menos um). */
export function blankStep(): StepDraft {
  return {
    templateName: '',
    languageCode: DEFAULT_LANGUAGE,
    delaySeconds: 0,
    stopOnReply: true,
    templateComponents: [],
  };
}

/** Estado inicial do modo criacao. */
export function emptyWizardState(): WizardState {
  return {
    name: '',
    type: 'broadcast',
    channelId: '',
    rows: [],
    optInOnImport: true,
    steps: [blankStep()],
    sendWindows: { enabled: false },
    rateLimitPerMinute: DEFAULT_RATE_LIMIT,
    autoHandoffOnReply: true,
  };
}

function toCampaignType(value: string): CampaignType {
  return CAMPAIGN_TYPES.includes(value as CampaignType) ? (value as CampaignType) : 'broadcast';
}

function toSendWindows(value: SendWindowsConfig | null | undefined): SendWindowsConfig {
  if (!value || typeof value.enabled !== 'boolean') return { enabled: false };
  if (!value.enabled) return { enabled: false };
  return {
    enabled: true,
    ...(value.timezone ? { timezone: value.timezone } : {}),
    windows: Array.isArray(value.windows) ? value.windows : [],
  };
}

function toStepDraft(step: CampaignStepRecord): StepDraft {
  return {
    templateName: step.templateName ?? '',
    languageCode: step.languageCode || DEFAULT_LANGUAGE,
    delaySeconds: Number.isFinite(step.delaySeconds) ? step.delaySeconds : 0,
    stopOnReply: step.stopOnReply ?? true,
    templateComponents: Array.isArray(step.templateComponents) ? step.templateComponents : [],
  };
}

/**
 * Converte o detalhe da API no estado do wizard. Steps chegam ordenados por
 * `position` da API; reordenamos por seguranca. Campanha sem steps ainda abre
 * com um step em branco (nunca com a lista vazia, que travaria o passo 3).
 */
export function toWizardState(detail: CampaignDetail): WizardState {
  const { campaign } = detail;
  const steps = [...(detail.steps ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(toStepDraft);

  return {
    name: campaign.name ?? '',
    type: toCampaignType(campaign.type),
    channelId: campaign.channelId ?? '',
    rows: [],
    optInOnImport: true,
    steps: steps.length > 0 ? steps : [blankStep()],
    sendWindows: toSendWindows(campaign.sendWindows),
    rateLimitPerMinute:
      Number.isFinite(campaign.rateLimitPerMinute) && campaign.rateLimitPerMinute > 0
        ? campaign.rateLimitPerMinute
        : DEFAULT_RATE_LIMIT,
    autoHandoffOnReply: campaign.autoHandoffOnReply ?? true,
  };
}

/** Steps prontos para `PUT /api/campaigns/:id/steps` (posicoes reindexadas). */
export function toStepsPayload(steps: StepDraft[]): CampaignStepInput[] {
  return steps.map((s, position) => ({
    position,
    templateName: s.templateName.trim(),
    languageCode: s.languageCode || DEFAULT_LANGUAGE,
    delaySeconds: Number.isFinite(s.delaySeconds) && s.delaySeconds > 0 ? s.delaySeconds : 0,
    stopOnReply: s.stopOnReply,
    templateComponents: s.templateComponents,
  }));
}

/**
 * Guard do passo "Mensagens": bloqueia o `PUT /steps` (delete+insert) quando o
 * rascunho esta vazio/incompleto — era assim que a edicao zerava os steps reais.
 */
export function stepsAreSafeToPersist(steps: StepDraft[]): boolean {
  return steps.length > 0 && steps.every((s) => s.templateName.trim().length > 0);
}
