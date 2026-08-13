/**
 * Preflight da Revisão (CAMPAIGNS.md §4.2, §5, §7 / F58-S06).
 *
 * A Revisão precisa responder duas coisas: "posso iniciar?" e "onde eu conserto
 * o que falta?". Por isso cada pendência carrega `stage` — a etapa do criador
 * que a corrige — além de um código estável e um texto pronto para exibir.
 *
 * Consistência deliberada com `POST /api/campaigns/:id/validate` (a validação
 * que roda na ATIVAÇÃO): tudo o que o `/validate` trata como crítico é
 * bloqueante aqui também. Um preflight mais permissivo que a ativação seria uma
 * promessa que a próxima tela quebra.
 *
 * Diferença de fonte, proposital: o preflight lê o CATÁLOGO LOCAL de modelos
 * (sincronizado + webhook, F58-S02/S04) para responder rápido a cada mudança do
 * formulário; a ativação confirma o estado ao vivo na Meta.
 *
 * Função PURA — nenhuma consulta, nenhum relógio implícito.
 */
import { decodeBindings, type DeliveryOverrides } from './contracts';
import { renderTemplate } from './render';
import {
  finalizeEstimate,
  type CampaignEstimate,
  type ChannelHealthSnapshot,
  type EstimateBase,
} from './service';

export type PreflightStage = 'basics' | 'audience' | 'message' | 'schedule' | 'channel';

export interface PreflightIssue {
  readonly code: string;
  readonly message: string;
  readonly stage: PreflightStage;
  readonly blocking: boolean;
  /** Posição da mensagem na sequência, quando a pendência é de uma delas. */
  readonly step?: number;
  readonly component?: 'header' | 'body' | 'button';
  readonly index?: number;
}

export interface PreflightResult {
  readonly ok: boolean;
  readonly issues: readonly PreflightIssue[];
  readonly estimate: CampaignEstimate;
}

/** Nome do estado do modelo em linguagem de produto (WHATSAPP_MESSAGE_TEMPLATES.md §4.3). */
const TEMPLATE_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING: 'está em análise',
  REJECTED: 'precisa de ajustes',
  PAUSED: 'está pausado',
  DISABLED: 'está desativado',
};

const ESTIMATE_STAGE: Readonly<Record<string, PreflightStage>> = {
  CAMPAIGN_PROVIDER_CAPACITY_UNKNOWN: 'channel',
  CAMPAIGN_CHANNEL_QUALITY_WARNING: 'channel',
  CAMPAIGN_CHANNEL_BLOCKED: 'channel',
  CAMPAIGN_SPLIT_ACROSS_DAYS: 'schedule',
  CAMPAIGN_DURATION_UNFEASIBLE: 'schedule',
  CAMPAIGN_AUDIENCE_EMPTY: 'audience',
};

export interface PreflightInput {
  readonly base: EstimateBase;
  readonly channelAvailable: boolean;
  readonly health: ChannelHealthSnapshot;
  readonly overrides: DeliveryOverrides;
  readonly now: Date;
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const { base } = input;
  const estimate = finalizeEstimate(base, input.health, input.overrides, input.now);
  const issues: PreflightIssue[] = [];

  if (!input.channelAvailable) {
    issues.push({
      code: 'CAMPAIGN_CHANNEL_NOT_AVAILABLE',
      message:
        'O canal desta campanha não está conectado. Reconecte o WhatsApp oficial para continuar.',
      stage: 'channel',
      blocking: true,
    });
  }

  if (base.campaign.type !== 'broadcast' && base.campaign.type !== 'drip') {
    issues.push({
      code: 'CAMPAIGN_TRIGGERED_NOT_AVAILABLE',
      message:
        'Campanhas automáticas por evento ainda não estão disponíveis. Escolha Envio único ou Sequência de mensagens.',
      stage: 'basics',
      blocking: true,
    });
  }

  // --- Mensagem ---------------------------------------------------------
  if (base.steps.length === 0) {
    issues.push({
      code: 'CAMPAIGN_NO_MESSAGE',
      message: 'Escolha a mensagem que será enviada.',
      stage: 'message',
      blocking: true,
    });
  }
  if (base.campaign.type === 'broadcast' && base.steps.length > 1) {
    issues.push({
      code: 'CAMPAIGN_SINGLE_EXPECTS_ONE_MESSAGE',
      message:
        'Um envio único usa uma mensagem só. Remova as demais ou troque o formato para sequência.',
      stage: 'message',
      blocking: true,
    });
  }
  if (base.campaign.type === 'drip' && base.steps.length === 1) {
    issues.push({
      code: 'CAMPAIGN_SEQUENCE_EXPECTS_MORE_MESSAGES',
      message: 'Uma sequência costuma ter duas ou mais mensagens. Adicione a próxima ou use envio único.',
      stage: 'message',
      blocking: false,
    });
  }

  for (const step of base.steps) {
    const at = step.position + 1;
    if (step.status === null) {
      issues.push({
        code: 'CAMPAIGN_TEMPLATE_NOT_FOUND',
        message: `A mensagem ${at} usa um modelo que não está no catálogo deste canal. Sincronize os modelos ou escolha outro.`,
        stage: 'message',
        blocking: true,
        step: at,
      });
      continue;
    }
    if (step.isAvailable === false) {
      issues.push({
        code: 'CAMPAIGN_TEMPLATE_UNAVAILABLE',
        message: `O modelo da mensagem ${at} não está mais disponível no WhatsApp. Escolha outro modelo.`,
        stage: 'message',
        blocking: true,
        step: at,
      });
      continue;
    }
    if (step.status !== 'APPROVED') {
      const label = TEMPLATE_STATUS_LABEL[step.status] ?? 'não está aprovado';
      issues.push({
        code: 'CAMPAIGN_TEMPLATE_NOT_APPROVED',
        message: `O modelo da mensagem ${at} ${label} e ainda não pode ser enviado. Escolha um modelo aprovado.`,
        stage: 'message',
        blocking: true,
        step: at,
      });
      continue;
    }

    const bindings = decodeBindings(step.templateComponents);
    if (bindings === null) {
      // Rascunho anterior ao contrato de bindings: os componentes já estão no
      // formato Graph e serão enviados como estão. Não dá para conferir variável
      // por variável, então avisa em vez de fingir que validou.
      const legacy = Array.isArray(step.templateComponents) && step.templateComponents.length > 0;
      const render = renderTemplate({
        name: step.templateName,
        language: step.languageCode,
        components: step.templateComponentsFromCatalog,
        bindings: [],
        contact: null,
      });
      const missing = render.ok
        ? []
        : render.issues.filter((issue) => issue.code === 'VARIABLE_MISSING');
      if (missing.length > 0 && legacy) {
        issues.push({
          code: 'CAMPAIGN_VARIABLES_NOT_REVIEWABLE',
          message: `Reabra a mensagem ${at} e confirme os valores das variáveis antes de iniciar.`,
          stage: 'message',
          blocking: false,
          step: at,
        });
      } else {
        for (const issue of missing) {
          issues.push({
            code: 'CAMPAIGN_VARIABLE_MISSING',
            message: `Mensagem ${at}: ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`,
            stage: 'message',
            blocking: true,
            step: at,
            ...(issue.component === undefined ? {} : { component: issue.component }),
            ...(issue.index === undefined ? {} : { index: issue.index }),
          });
        }
      }
      continue;
    }

    const render = renderTemplate({
      name: step.templateName,
      language: step.languageCode,
      components: step.templateComponentsFromCatalog,
      bindings,
      contact: null,
    });
    if (render.ok) continue;
    for (const issue of render.issues) {
      issues.push({
        code: `CAMPAIGN_${issue.code}`,
        message: `Mensagem ${at}: ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`,
        stage: 'message',
        blocking: true,
        step: at,
        ...(issue.component === undefined ? {} : { component: issue.component }),
        ...(issue.index === undefined ? {} : { index: issue.index }),
      });
    }
  }

  // --- Público ----------------------------------------------------------
  if (base.requiresMarketingOptIn && base.audience.noConsent > 0) {
    issues.push({
      code: 'CAMPAIGN_AUDIENCE_WITHOUT_CONSENT',
      message: `${base.audience.noConsent} contatos não autorizaram receber ofertas. Remova-os do público ou registre o consentimento antes de iniciar.`,
      stage: 'audience',
      blocking: true,
    });
  }
  const providerDailyLimit = estimate.capacity.providerDailyLimit;
  if (providerDailyLimit !== null && base.audience.eligible > providerDailyLimit) {
    issues.push({
      code: 'CAMPAIGN_AUDIENCE_EXCEEDS_TIER',
      message: `Este canal entrega até ${providerDailyLimit} mensagens por dia e o público tem ${base.audience.eligible}. Reduza o público para iniciar.`,
      stage: 'audience',
      blocking: true,
    });
  }

  // --- Quando enviar ----------------------------------------------------
  const sendWindowsEnabled =
    input.overrides.sendWindows?.enabled ?? base.campaign.sendWindows.enabled;
  if (!sendWindowsEnabled) {
    issues.push({
      code: 'CAMPAIGN_SEND_WINDOWS_DISABLED',
      message: 'Sem horários definidos, a campanha pode enviar de madrugada. Escolha os horários permitidos.',
      stage: 'schedule',
      blocking: false,
    });
  }
  if (estimate.capacity.ratePerMinute > 60) {
    issues.push({
      code: 'CAMPAIGN_RATE_TOO_HIGH',
      message: 'Este ritmo é agressivo para o WhatsApp e pode derrubar a qualidade do número.',
      stage: 'schedule',
      blocking: false,
    });
  }

  // Avisos da estimativa entram como pendências com a etapa que os corrige, sem
  // duplicar o que já foi dito acima.
  const seen = new Set(issues.map((issue) => issue.code));
  for (const warning of estimate.warnings) {
    if (seen.has(warning.code)) continue;
    issues.push({
      code: warning.code,
      message: warning.message,
      stage: ESTIMATE_STAGE[warning.code] ?? 'schedule',
      blocking: warning.blocking,
    });
  }

  return {
    ok: issues.every((issue) => !issue.blocking),
    issues,
    estimate,
  };
}
