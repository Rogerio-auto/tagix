/**
 * Registry de Niche Blueprints (F43-S03 / ONBOARDING.md §2.3).
 *
 * Fonte única `key → NicheBlueprint` para os 7 nichos da landing. Consumido pelo
 * endpoint de aplicação (F43-S04) e pelo wizard de onboarding (F43-S05). Cada
 * blueprint é declarativo e idempotentemente aplicável por `instantiateNicheBlueprint`.
 *
 * Flows escalonados: `real_estate`/`health`/`law` saem com flows POPULADOS; os
 * outros 4 (`education`/`solar`/`retail`/`agency`) entram com `flows: []` e são
 * preenchidos no F43-S09.
 */
import type { NicheBlueprint } from './types';
import { agencyBlueprint } from './blueprints/agency';
import { educationBlueprint } from './blueprints/education';
import { healthBlueprint } from './blueprints/health';
import { lawBlueprint } from './blueprints/law';
import { realEstateBlueprint } from './blueprints/real_estate';
import { retailBlueprint } from './blueprints/retail';
import { solarBlueprint } from './blueprints/solar';

/** Chaves canônicas dos 7 nichos (alinhadas à landing). */
export type NicheKey =
  | 'real_estate'
  | 'health'
  | 'education'
  | 'solar'
  | 'retail'
  | 'law'
  | 'agency';

/** Registry imutável `key → blueprint`. */
export const NICHE_BLUEPRINTS: Record<NicheKey, NicheBlueprint> = {
  real_estate: realEstateBlueprint,
  health: healthBlueprint,
  education: educationBlueprint,
  solar: solarBlueprint,
  retail: retailBlueprint,
  law: lawBlueprint,
  agency: agencyBlueprint,
};

/** Lista de chaves de nicho conhecidas (ordem de exibição). */
export const NICHE_KEYS = Object.keys(NICHE_BLUEPRINTS) as NicheKey[];

/** Type guard: a string é uma chave de nicho conhecida? */
export function isNicheKey(key: string): key is NicheKey {
  return Object.prototype.hasOwnProperty.call(NICHE_BLUEPRINTS, key);
}

/** Resolve um blueprint por chave; `undefined` se desconhecida (sem `any`). */
export function getBlueprint(key: string): NicheBlueprint | undefined {
  return isNicheKey(key) ? NICHE_BLUEPRINTS[key] : undefined;
}

export type { NicheBlueprint } from './types';
