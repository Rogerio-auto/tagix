/** Feature de onboarding / first-run (F43-S05). */
export { OnboardingProvider } from './components/OnboardingProvider';
export { OnboardingWizard } from './components/OnboardingWizard';
export type { OnboardingWizardProps } from './components/OnboardingWizard';
export { NICHE_OPTIONS, NICHE_ICON, getNicheOption, suggestNiche } from './niches';
export { useOnboardingState, useSaveSurvey, useApplyNiche, onboardingKeys } from './queries';
export type {
  NicheKey,
  NicheOption,
  TeamSize,
  SurveyGoal,
  SurveyAnswers,
  WorkspaceOnboardingState,
  OnboardingStateResponse,
  SurveyInput,
  ApplyNicheInput,
  ApplyNicheResult,
} from './types';
