/**
 * Origem da conversa como dado persistido (F70-S07).
 *
 * `conversations.origin` guarda de onde a conversa veio, classificada UMA vez, na
 * criação, por `classifyConversationOrigin` (`@hm/channels`). A regra de quem a IA
 * pode atender (`isAiEligibleOrigin`) também mora lá; este módulo cuida só do que
 * atravessa o banco e a configuração do workspace:
 *
 * - o domínio exato da coluna (o CHECK da migração 0083 espelha esta lista);
 * - a leitura FAIL-CLOSED da coluna: `NULL` (conversa anterior à 0083, ou criada
 *   por um caminho que não classifica) e qualquer valor fora do domínio viram
 *   `sem-origem`. O número do dono é pessoal — na dúvida, a IA não fala;
 * - os marcadores de texto pré-preenchido dos botões do site/Instagram, lidos de
 *   `workspaces.settings` com default VAZIO (nada vira `origem:site` por engano).
 */
import { z } from 'zod';

/** Valores de `conversations.origin` — iguais aos nomes das etiquetas de origem. */
export const CONVERSATION_ORIGINS = [
  'origem:anuncio',
  'origem:site',
  'origem:instagram',
  'origem:prospeccao',
  'sem-origem',
] as const;

export type ConversationOriginValue = (typeof CONVERSATION_ORIGINS)[number];

/** Origem assumida quando nada a comprova. */
export const UNPROVEN_CONVERSATION_ORIGIN = 'sem-origem' as const satisfies ConversationOriginValue;

const ORIGIN_SET: ReadonlySet<string> = new Set(CONVERSATION_ORIGINS);

/**
 * Lê a origem vinda do banco (ou de qualquer fonte não confiável). Fail-closed:
 * ausente/desconhecida → `sem-origem`.
 */
export function normalizeConversationOrigin(raw: unknown): ConversationOriginValue {
  if (typeof raw === 'string' && ORIGIN_SET.has(raw)) return raw as ConversationOriginValue;
  return UNPROVEN_CONVERSATION_ORIGIN;
}

/** Chave em `workspaces.settings` com os marcadores dos botões. */
export const ORIGIN_PREFILL_MARKERS_SETTINGS_KEY = 'originPrefillMarkers' as const;

/** Limites defensivos: config é input de tenant, não pode virar vetor de custo. */
const MAX_MARKERS_PER_SOURCE = 20;
const MAX_MARKER_LENGTH = 200;

const markerListSchema = z
  .array(z.string().trim().min(1).max(MAX_MARKER_LENGTH))
  .max(MAX_MARKERS_PER_SOURCE);

export const originPrefillMarkersSchema = z.object({
  site: markerListSchema.optional(),
  instagram: markerListSchema.optional(),
});

/** Marcadores prontos para `classifyConversationOrigin` (listas sempre presentes). */
export interface OriginPrefillMarkersConfig {
  readonly site: readonly string[];
  readonly instagram: readonly string[];
}

const NO_MARKERS: OriginPrefillMarkersConfig = { site: [], instagram: [] };

/**
 * Extrai os marcadores de `workspaces.settings`. Formato:
 * `{ "originPrefillMarkers": { "site": ["Vim pelo site"], "instagram": ["Vim pelo Instagram"] } }`.
 *
 * Ausente ou inválido → listas vazias (fail-closed: sem marcador, só anúncio e o
 * Direct do Instagram comprovam origem). Configuração inválida não derruba o
 * inbound — ela simplesmente não abre a IA para ninguém.
 */
export function originPrefillMarkersFromSettings(settings: unknown): OriginPrefillMarkersConfig {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return NO_MARKERS;
  }
  const raw = (settings as Record<string, unknown>)[ORIGIN_PREFILL_MARKERS_SETTINGS_KEY];
  if (raw === undefined) return NO_MARKERS;
  const parsed = originPrefillMarkersSchema.safeParse(raw);
  if (!parsed.success) return NO_MARKERS;
  return { site: parsed.data.site ?? [], instagram: parsed.data.instagram ?? [] };
}
