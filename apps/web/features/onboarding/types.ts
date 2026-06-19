/**
 * Tipos da feature de onboarding / first-run (F43-S05).
 *
 * O wizard de boas-vindas escolhe um dos 7 nichos canônicos (espelhando o registry
 * de blueprints em `@hm/db`), aplica o blueprint (funil + agente(s) + etiquetas +
 * conversões + departamentos + respostas rápidas + flows) e grava o estado de
 * onboarding do workspace. A mini-pesquisa (tipo de negócio, tamanho do time,
 * objetivo) é persistida à parte e pode sugerir o nicho.
 *
 * As chaves e enums espelham o contrato da API (F43-S04): `survey.ts` (TEAM_SIZES,
 * SURVEY_GOALS) e o registry de nichos (`NICHE_KEYS`).
 */

/** Chaves canônicas dos 7 nichos (alinhadas à landing e ao registry @hm/db). */
export type NicheKey = 'real_estate' | 'health' | 'education' | 'solar' | 'retail' | 'law' | 'agency';

/** Tamanho do time declarado (faixas) — espelha `TEAM_SIZES` da API. */
export type TeamSize = 'solo' | '2-5' | '6-20' | '21-50' | '50+';

/** Objetivo principal ao entrar na Leadium — espelha `SURVEY_GOALS` da API. */
export type SurveyGoal = 'sell_more' | 'support_faster' | 'automate' | 'organize_pipeline' | 'other';

/** Catálogo (client-side) de um nicho: rótulo, descrição, preview do funil. */
export interface NicheOption {
  key: NicheKey;
  /** Rótulo pt-BR (ex.: "Imobiliária"). */
  name: string;
  /** Frase curta de valor (espelha a landing). */
  description: string;
  /** Pré-visualização dos estágios do funil que o blueprint cria. */
  stages: string[];
}

/** Respostas da mini-pesquisa (todas opcionais — submissão incremental). */
export interface SurveyAnswers {
  businessType?: string;
  teamSize?: TeamSize;
  goal?: SurveyGoal;
  goalDetail?: string;
}

/** Estado de onboarding do workspace (subset consumido pelo first-run). */
export interface WorkspaceOnboardingState {
  niche_key: NicheKey | null;
  applied_at: string | null;
  survey: SurveyAnswers | null;
  setup_completed: boolean;
}

/** Resposta de `GET /api/onboarding/state` (campos consumidos pelo wizard). */
export interface OnboardingStateResponse {
  onboarding: WorkspaceOnboardingState;
}

/** Body de `PUT /api/onboarding/survey`. */
export type SurveyInput = SurveyAnswers;

/** Body de `POST /api/onboarding/apply`. */
export interface ApplyNicheInput {
  niche: NicheKey;
}

/** Resposta de `POST /api/onboarding/apply` (201). */
export interface ApplyNicheResult {
  pipelineId: string;
  agentIds: string[];
  createdCounts: Record<string, number>;
}
