/**
 * Rótulos pt-BR da mini-pesquisa de first-run (F43-S05). Os valores espelham
 * exatamente os enums do schema da API (F43-S04 `routes/onboarding/survey.ts`:
 * `TEAM_SIZES`, `SURVEY_GOALS`) — o servidor rejeita qualquer outro valor.
 */
import type { SurveyGoal, TeamSize } from './types';

export const TEAM_SIZE_OPTIONS: ReadonlyArray<{ value: TeamSize; label: string }> = [
  { value: 'solo', label: 'Só eu' },
  { value: '2-5', label: '2 a 5 pessoas' },
  { value: '6-20', label: '6 a 20 pessoas' },
  { value: '21-50', label: '21 a 50 pessoas' },
  { value: '50+', label: 'Mais de 50' },
];

export const GOAL_OPTIONS: ReadonlyArray<{ value: SurveyGoal; label: string }> = [
  { value: 'sell_more', label: 'Vender mais' },
  { value: 'support_faster', label: 'Atender mais rápido' },
  { value: 'automate', label: 'Automatizar tarefas' },
  { value: 'organize_pipeline', label: 'Organizar meu funil' },
  { value: 'other', label: 'Outro objetivo' },
];
