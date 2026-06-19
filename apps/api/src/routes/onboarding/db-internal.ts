/**
 * Ponte para os módulos de onboarding do pacote `@hm/db` (F43-S01/S02/S03).
 *
 * O instanciador de blueprint, o registry de nichos e o repo de estado de
 * onboarding/tour vivem em `@hm/db`. São consumidos via o surface PÚBLICO do
 * pacote (barrel `@hm/db` + subpath `@hm/db/seed/niches`) — nunca por caminho
 * relativo para o `src` de outro pacote (isso viola o `rootDir` do tsc e a regra
 * "DAL só via @hm/db"). Centralizar os imports aqui mantém o acoplamento num
 * único ponto e facilita o teste (um único `vi.mock('./db-internal')`).
 */
export {
  onboardingRepo,
  instantiateNicheBlueprint,
  getBlueprint,
  isNicheKey,
  NICHE_KEYS,
} from '@hm/db';
export type {
  WorkspaceOnboarding,
  MemberTourState,
  TourEntry,
  NicheBlueprint,
  NicheKey,
  InstantiateResult,
} from '@hm/db';
