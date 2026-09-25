/**
 * Origem da conversa (F70-S05) — de onde o contato veio, e se a IA pode atender.
 *
 * Regra crítica: o número é PESSOAL. Família, amigos e contatos antigos escrevem
 * para o mesmo WhatsApp que recebe os anúncios. A IA só atende conversa com
 * origem COMPROVADA (anúncio, botão do site, botão do Instagram / DM do IG).
 * Tudo que não prova origem é `sem-origem` e nunca recebe resposta da IA.
 *
 * Por isso a função é fail-closed: na dúvida, `sem-origem`. Um falso negativo
 * custa um lead atendido por humano; um falso positivo põe um robô falando com a
 * mãe do dono.
 *
 * Pura, sem I/O. O worker/flow chama, grava a etiqueta e decide o `ACTIVATE`.
 */

import type { InboundEvent } from '../../types';
import {
  isPaidAdReferral,
  parseInstagramReferral,
  readAdReferral,
  type AdReferral,
} from './ad-referral';

/** Etiquetas de origem, exatamente como aparecem em `tags.name`. */
export const CONVERSATION_ORIGIN_TAGS = {
  anuncio: 'origem:anuncio',
  site: 'origem:site',
  instagram: 'origem:instagram',
  prospeccao: 'origem:prospeccao',
  semOrigem: 'sem-origem',
} as const;

export type ConversationOrigin =
  (typeof CONVERSATION_ORIGIN_TAGS)[keyof typeof CONVERSATION_ORIGIN_TAGS];

/**
 * Trechos da mensagem pré-preenchida de cada botão (`wa.me/<n>?text=...`).
 * Configuração do workspace; comparação sem acento/caixa/espaço extra.
 */
export interface OriginPrefillMarkers {
  readonly site?: readonly string[];
  readonly instagram?: readonly string[];
}

export interface ConversationOriginInput {
  /** Provider do canal da conversa. */
  readonly provider: InboundEvent['provider'];
  /**
   * Quem mandou a PRIMEIRA mensagem da conversa. `business` = o dono pelo app
   * (eco da coexistência, F70-S04) ou envio pelo Leadium: prospecção.
   */
  readonly initiatedBy: 'contact' | 'business';
  /** Referral da primeira mensagem inbound (ver `adReferralFromInboundEvent`). */
  readonly adReferral?: AdReferral;
  /** Texto da primeira mensagem inbound do contato. */
  readonly firstInboundText?: string;
  readonly prefillMarkers?: OriginPrefillMarkers;
}

/**
 * Marcador curto demais casaria com conversa comum ("oi", "olá") e abriria a IA
 * para qualquer um. Abaixo disso o marcador é ignorado — fail-closed.
 */
export const MIN_PREFILL_MARKER_LENGTH = 8;

/** Minúsculas, sem acento, espaços colapsados. */
function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesAnyMarker(normalizedText: string, markers: readonly string[] | undefined): boolean {
  if (markers === undefined) return false;
  for (const m of markers) {
    const nm = normalizeText(m);
    if (nm.length < MIN_PREFILL_MARKER_LENGTH) continue;
    if (normalizedText.includes(nm)) return true;
  }
  return false;
}

/**
 * Classifica a origem. Precedência (a primeira que casar vence):
 *
 * 1. `origem:prospeccao` — conversa iniciada pelo negócio. Nada que o contato
 *    mande depois muda isso (F70-S04: IA desligada).
 * 2. `origem:anuncio` — referral de mídia paga (CTWA ou anúncio do IG).
 * 3. `origem:site` — texto pré-preenchido do botão do site.
 * 4. `origem:instagram` — texto pré-preenchido do botão do Instagram, OU a
 *    conversa nasceu no Direct do Instagram (o próprio canal prova a origem).
 * 5. `sem-origem` — o resto.
 */
export function classifyConversationOrigin(input: ConversationOriginInput): ConversationOrigin {
  if (input.initiatedBy === 'business') return CONVERSATION_ORIGIN_TAGS.prospeccao;

  if (isPaidAdReferral(input.adReferral)) return CONVERSATION_ORIGIN_TAGS.anuncio;

  const text = input.firstInboundText !== undefined ? normalizeText(input.firstInboundText) : '';
  if (text !== '') {
    if (matchesAnyMarker(text, input.prefillMarkers?.site)) return CONVERSATION_ORIGIN_TAGS.site;
    if (matchesAnyMarker(text, input.prefillMarkers?.instagram)) {
      return CONVERSATION_ORIGIN_TAGS.instagram;
    }
  }

  if (input.provider === 'meta_instagram') return CONVERSATION_ORIGIN_TAGS.instagram;

  return CONVERSATION_ORIGIN_TAGS.semOrigem;
}

/**
 * A IA pode ser ativada nesta conversa? Só com origem comprovada. `prospeccao`
 * fica fora (o dono está conduzindo) e `sem-origem` NUNCA.
 */
export function isAiEligibleOrigin(origin: ConversationOrigin): boolean {
  return (
    origin === CONVERSATION_ORIGIN_TAGS.anuncio ||
    origin === CONVERSATION_ORIGIN_TAGS.site ||
    origin === CONVERSATION_ORIGIN_TAGS.instagram
  );
}

/**
 * Extrai o referral normalizado de qualquer `InboundEvent` Meta:
 * - `message` (WA e IG): `metadata.adReferral`, gravado pelos parsers;
 * - `referral` (IG, evento avulso de `messaging[].referral`): normaliza o cru.
 */
export function adReferralFromInboundEvent(event: InboundEvent): AdReferral | undefined {
  switch (event.type) {
    case 'message':
      return readAdReferral(event.metadata?.['adReferral']);
    case 'referral':
      return parseInstagramReferral(
        event.referralData,
        event.rawTimestamp ?? new Date().toISOString(),
      );
    default:
      return undefined;
  }
}
