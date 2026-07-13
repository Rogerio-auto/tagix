/**
 * Tipos do wizard de campanha (criacao + edicao).
 *
 * Espelham o payload de `GET /api/campaigns/:id` (apps/api/src/routes/campaigns/crud.ts)
 * e os schemas Zod de create/update/steps. Ficam locais ao editor de proposito:
 * a fronteira do slot e `features/campaigns/editor/**` e o wizard nao deve
 * acoplar-se aos tipos de lista/monitoramento (que evoluem em outros slots).
 */
import type { CsvRow } from './csv';

export type CampaignType = 'broadcast' | 'drip' | 'triggered';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type FollowupTrigger = 'on_reply' | 'on_no_reply' | 'on_delivered';

/** Componente de template Meta (variaveis/botoes). Sem UI ainda (CAMP-09) — so trafega. */
export type TemplateComponent = Record<string, unknown>;

export interface SendWindowSlot {
  /** 0 = domingo … 6 = sabado. */
  day: number;
  /** HH:MM. */
  start: string;
  /** HH:MM. */
  end: string;
}

export interface SendWindowsConfig {
  enabled: boolean;
  timezone?: string;
  windows?: SendWindowSlot[];
}

/* ── Payloads de escrita (espelham os schemas Zod da API) ───────────────── */

export interface CreateCampaignInput {
  channelId: string;
  name: string;
  type: CampaignType;
  sendWindows?: SendWindowsConfig;
  rateLimitPerMinute?: number;
  autoHandoffOnReply?: boolean;
  aiHandoffAgentId?: string | null;
}

export interface CampaignStepInput {
  position: number;
  templateName: string;
  languageCode?: string;
  delaySeconds?: number;
  stopOnReply?: boolean;
  /**
   * `PUT /steps` faz delete+insert: nao reenviar os componentes apaga as variaveis
   * ja configuradas. A hidratacao carrega e devolve o que veio do servidor.
   */
  templateComponents?: TemplateComponent[];
}

/* ── Payloads de leitura (GET /api/campaigns/:id) ───────────────────────── */

export interface CampaignRecord {
  id: string;
  workspaceId: string;
  channelId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  timezone: string;
  startAt: string | null;
  endAt: string | null;
  sendWindows: SendWindowsConfig | null;
  rateLimitPerMinute: number;
  dailyLimit: number | null;
  autoHandoffOnReply: boolean;
  aiHandoffAgentId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CampaignStepRecord {
  id: string;
  campaignId: string;
  position: number;
  templateName: string;
  languageCode: string;
  templateComponents: TemplateComponent[] | null;
  delaySeconds: number;
  stopOnReply: boolean;
}

export interface CampaignFollowupRecord {
  id: string;
  campaignId: string;
  triggerEvent: FollowupTrigger;
  delayMinutes: number;
  templateName: string;
  languageCode: string;
  position: number;
  isActive: boolean;
}

export interface CampaignDetail {
  campaign: CampaignRecord;
  steps: CampaignStepRecord[];
  followups: CampaignFollowupRecord[];
}

/* ── Estado do wizard ───────────────────────────────────────────────────── */

export interface StepDraft {
  templateName: string;
  languageCode: string;
  delaySeconds: number;
  stopOnReply: boolean;
  templateComponents: TemplateComponent[];
}

export interface WizardState {
  name: string;
  type: CampaignType;
  channelId: string;
  /** Linhas do CSV colado nesta sessao (destinatarios ja importados vivem no servidor). */
  rows: CsvRow[];
  optInOnImport: boolean;
  steps: StepDraft[];
  sendWindows: SendWindowsConfig;
  rateLimitPerMinute: number;
  autoHandoffOnReply: boolean;
}

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

export interface BulkRecipientsResult {
  total: number;
  recipientsAdded: number;
  contactsCreated: number;
  contactsReused: number;
  invalid: number;
  report: Array<{ phone: string; status: string; reason?: string }>;
}
