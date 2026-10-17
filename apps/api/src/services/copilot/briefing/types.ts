/**
 * Tipos e constantes do briefing do dia (F73-S12; COPILOTO.md §7.1).
 *
 * Tudo que se calibra por telemetria (F73-S15) é constante NOMEADA aqui: o horário da manhã,
 * o limite de revalidação, a idade máxima por fonte e os pesos do score ficam à vista, num
 * lugar só, e nunca enterrados num `if`.
 */
import type { CopilotPrincipal } from '../identity/principal';
import type { WorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import type { BriefingItem, BriefingItemKind } from '@hm/shared';

// ─── Calibração ──────────────────────────────────────────────────────────────

/** Minutos desde a meia-noite local em que o briefing sai (06:30). */
export const BRIEFING_SEND_LOCAL_MINUTES = 6 * 60 + 30;
/**
 * Janela de recuperação depois das 06:30: se a API estava fora do ar às 06:30, ainda se
 * envia até 10:30 (depois disso o "briefing da manhã" já não é da manhã e o push não sai).
 */
export const BRIEFING_CATCHUP_MINUTES = 4 * 60;
/** Intervalo do agendador. A janela é de horas, então 5 min dá folga e custa uma query. */
export const BRIEFING_TICK_INTERVAL_MS = 5 * 60_000;
/** Briefing gerado há mais que isso é revalidado ao abrir. */
export const BRIEFING_REVALIDATE_AFTER_MS = 60 * 60_000;
/** Só quem esteve no app nos últimos N dias recebe o briefing da manhã. */
export const BRIEFING_ACTIVE_WINDOW_DAYS = 14;
/** Membros por lote no agendador. */
export const BRIEFING_MEMBER_BATCH = 50;
/** Dias sem resposta do cliente para um negócio entrar em `deals_idle` (padrão da spec). */
export const BRIEFING_IDLE_DAYS = 3;
/** Janela do ticket médio dos ganhos (spec §7.1: últimos 90 dias). */
export const BRIEFING_TICKET_WINDOW_DAYS = 90;
/** Quantos grupos/campanhas cada tipo propõe antes da escolha dos 3 (teto de custo). */
export const BRIEFING_MAX_GROUPS_PER_KIND = 20;
/**
 * Alcance pendente de campanha → receita estimada. Não existe custo de campanha no código
 * (COPILOTO.md §11), então o "valor em risco" é o alcance pendente × ticket médio × esta
 * taxa de conversão conservadora. Aparece no `why` do item, não é número escondido.
 */
export const BRIEFING_CAMPAIGN_REACH_RATE = 0.02;

/** Idade máxima do dado por fonte: acima dela o item não aparece como fato. */
export const BRIEFING_SOURCE_MAX_AGE_MS: Readonly<Record<BriefingItemKind, number>> = {
  deals_idle: 60 * 60_000,
  leads_waiting: 15 * 60_000,
  events_today: 60 * 60_000,
  autopilot_pending: 60 * 60_000,
  campaign_issue: 60 * 60_000,
  integration_alert: 60 * 60_000,
};

// ─── Candidatos ──────────────────────────────────────────────────────────────

/** Ação de um clique, antes de virar `BriefingItem['action']`. */
export type CandidateAction =
  | { readonly kind: 'navigate'; readonly value: string; readonly label: string }
  | { readonly kind: 'ask'; readonly value: string; readonly label: string };

/** Fatos de cada tipo: o que o modelo de texto precisa para escrever (nunca nome de contato). */
export type CandidateFacts =
  | {
      readonly kind: 'deals_idle';
      readonly count: number;
      readonly stageId: string;
      readonly stageName: string;
      readonly idleDaysThreshold: number;
      readonly maxIdleDays: number;
      readonly avgIdleDays: number;
      /** Nome de um estágio de reativação no mesmo funil, quando existe. */
      readonly reactivationStageName: string | null;
    }
  | {
      readonly kind: 'leads_waiting';
      readonly count: number;
      readonly oldestWaitingMinutes: number;
      readonly ticket: number;
      readonly ticketBasis: 'won_90d' | 'open' | 'none';
    }
  | {
      readonly kind: 'events_today';
      readonly count: number;
      readonly dealCount: number;
      readonly hoursUntilFirst: number;
    }
  | {
      readonly kind: 'autopilot_pending';
      readonly count: number;
    }
  | {
      readonly kind: 'campaign_issue';
      readonly campaignId: string;
      readonly campaignName: string;
      readonly health: 'warning' | 'critical';
      readonly sent: number;
      readonly total: number;
      readonly failed: number;
      readonly pending: number;
      readonly ticket: number;
    }
  | {
      /** `integration_alert`: o provedor (F75) já entrega o texto pronto. */
      readonly kind: 'integration_alert';
      readonly title: string;
      readonly why: readonly string[];
      readonly action: CandidateAction;
    };

/** Referências para reconferir o item na revalidação (sem PII, só ids). */
export interface CandidateRefs {
  readonly stageId?: string;
  readonly campaignId?: string;
  readonly sourceId?: string;
  readonly externalRef?: string;
}

export interface BriefingCandidate {
  readonly kind: BriefingItemKind;
  /** Identidade estável do item (vira `BriefingItem.id`). */
  readonly key: string;
  /** Receita em risco, na moeda do workspace (unidades, não centavos). */
  readonly valueAtRisk: number;
  /**
   * Eixo de urgência do tipo: dias parado (`deals_idle`), minutos de espera
   * (`leads_waiting`), horas até o compromisso (`events_today`), saúde da campanha
   * (0 = warning, 1 = critical) ou fixo (0).
   */
  readonly urgency: number;
  /** Registro mais antigo por trás do item (desempate: o mais antigo primeiro). */
  readonly oldestAt: Date;
  readonly facts: CandidateFacts;
  readonly refs: CandidateRefs;
  /** Nome da fonte exibido ("Pipeline", "Agenda"). */
  readonly source: string;
  /** De quando é o dado. */
  readonly asOf: Date;
}

/** Contexto de leitura compartilhado pelos coletores. */
export interface CandidateContext {
  readonly principal: CopilotPrincipal;
  readonly fmt: WorkspaceFormat;
  readonly now: Date;
  /** Data local do workspace (`YYYY-MM-DD`). */
  readonly forDate: string;
}

// ─── Persistência ────────────────────────────────────────────────────────────

/** Metadados guardados ao lado do item (jsonb). Nunca saem na API. */
export interface StoredMeta {
  readonly v: number;
  readonly kind: BriefingItemKind;
  readonly score: number;
  readonly since: string;
  readonly refs: CandidateRefs;
}

/** Um item como gravado em `copilot_briefings.items`: o `BriefingItem` + `_meta`. */
export type StoredBriefingItem = BriefingItem & { readonly _meta: StoredMeta };
