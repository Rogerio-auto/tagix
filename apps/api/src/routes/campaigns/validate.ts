/**
 * Validacao pre-ativacao de campanha (CAMPAIGNS.md 5 + 17.2 IG).
 *
 * Funcao PURA e injetavel: recebe os dados ja carregados + funcoes de Graph
 * (fetchMetaTemplate/fetchChannelQuality) por parametro, para ser testavel SEM
 * WABA real (a Meta nao tem WABA conectada no dev — os helpers sao mockados).
 *
 * Compliance e DURA (nao afrouxar):
 *  - activate so com safe=true (criticalIssues vazio);
 *  - template precisa estar APPROVED;
 *  - categoria MARKETING exige opt-in de TODOS os recipients;
 *  - quality RED bloqueia (critical); YELLOW e warning;
 *  - recipients > tierLimit e critical;
 *  - IG (provider meta_instagram): sem template_name (usa text/interactive),
 *    recipients sem interacao previa = critical, block threshold menor.
 */
import type {
  ChannelHealth,
  MetaTemplateInfo,
} from '@hm/channels';

export interface ValidationResult {
  safe: boolean;
  criticalIssues: string[];
  warnings: string[];
  stats: {
    steps: number;
    recipients: number;
    recipientsWithoutOptIn: number;
    qualityRating: string;
    tierLimit: number;
  };
}

/** Step minimo para validacao. */
export interface ValidationStep {
  readonly templateName: string;
  readonly languageCode: string;
}

/** Snapshot da campanha + canal para validacao. */
export interface ValidationCampaign {
  readonly id: string;
  readonly provider: 'meta_whatsapp' | 'meta_instagram' | 'waha';
  readonly steps: readonly ValidationStep[];
  readonly recipientCount: number;
  /** Recipients sem marketing_opt_in (join contacts) — usado se algum step e MARKETING. */
  readonly recipientsWithoutOptIn: number;
  /** Recipients SEM conversa inbound previa nesse canal (IG 17.2). */
  readonly recipientsWithoutPriorInteraction: number;
  readonly sendWindowsEnabled: boolean;
  readonly rateLimitPerMinute: number;
}

/** Funcoes de Graph injetadas (mockaveis em teste). */
export interface ValidationGraphPorts {
  fetchTemplate(step: ValidationStep): Promise<MetaTemplateInfo>;
  fetchQuality(): Promise<ChannelHealth>;
}

/**
 * Executa as 7 checagens do 5 (+ extras IG do 17.2). Nao toca em IO alem das
 * portas injetadas — toda a logica de compliance e testavel com mocks.
 */
export async function validateCampaign(
  campaign: ValidationCampaign,
  ports: ValidationGraphPorts,
): Promise<ValidationResult> {
  const criticalIssues: string[] = [];
  const warnings: string[] = [];
  const isInstagram = campaign.provider === 'meta_instagram';

  // 1. Steps existem.
  if (campaign.steps.length === 0) {
    criticalIssues.push('Nenhum step configurado');
  }

  // 2 + 3. Templates approved + opt-in obrigatorio se MARKETING.
  let anyMarketing = false;
  for (const step of campaign.steps) {
    if (isInstagram) {
      // 17.2.1: IG nao tem templates HSM. Step com template_name e invalido.
      if (step.templateName) {
        criticalIssues.push(
          'IG: step usa template_name (' + step.templateName + ') — Instagram nao tem templates Meta; use mensagem direta/interactive',
        );
      }
      continue;
    }
    const template = await ports.fetchTemplate(step);
    if (template.status !== 'APPROVED') {
      criticalIssues.push(
        'Template ' + step.templateName + ' nao esta APROVADO (status: ' + template.status + ')',
      );
    }
    if (template.category === 'MARKETING') anyMarketing = true;
  }

  if (anyMarketing && campaign.recipientsWithoutOptIn > 0) {
    criticalIssues.push(
      String(campaign.recipientsWithoutOptIn) + ' recipients sem opt-in para MARKETING',
    );
  }

  // 4. Canal ativo + quality rating.
  const health = await ports.fetchQuality();
  if (health.qualityRating === 'RED') {
    criticalIssues.push('Quality rating RED — canal bloqueado');
  } else if (health.qualityRating === 'YELLOW') {
    warnings.push('Quality rating YELLOW — risco moderado');
  } else if (health.qualityRating === 'UNKNOWN') {
    warnings.push('Quality rating desconhecido — nao foi possivel ler da Meta');
  }

  // 5. Tier Meta suporta volume.
  if (campaign.recipientCount > health.tierLimit) {
    criticalIssues.push(
      'Recipients (' + String(campaign.recipientCount) + ') excede o tier limit (' + String(health.tierLimit) + ')',
    );
  }

  // 6. Send windows configurada?
  if (!campaign.sendWindowsEnabled) {
    warnings.push('Send windows nao configurada — envia 24/7');
  }

  // 7. Rate limit conservador?
  if (campaign.rateLimitPerMinute > 60) {
    warnings.push('Rate limit alto (>60/min) — risco de quality YELLOW');
  }

  // 17.2: IG — recipients sem interacao previa sao PROIBIDOS pela Meta.
  if (isInstagram && campaign.recipientsWithoutPriorInteraction > 0) {
    criticalIssues.push(
      'IG: ' + String(campaign.recipientsWithoutPriorInteraction) + ' recipients sem interacao previa (proibido pela Meta)',
    );
  }

  return {
    safe: criticalIssues.length === 0,
    criticalIssues,
    warnings,
    stats: {
      steps: campaign.steps.length,
      recipients: campaign.recipientCount,
      recipientsWithoutOptIn: campaign.recipientsWithoutOptIn,
      qualityRating: health.qualityRating,
      tierLimit: health.tierLimit,
    },
  };
}
