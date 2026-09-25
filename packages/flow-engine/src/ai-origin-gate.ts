/**
 * Trava de origem da IA (F70-S07).
 *
 * O número do dono é pessoal: família e contatos antigos escrevem para o mesmo
 * WhatsApp que recebe os anúncios. Nenhum caminho AUTOMÁTICO pode ligar a IA numa
 * conversa sem origem comprovada. A regra de elegibilidade é uma só —
 * `isAiEligibleOrigin` (`@hm/channels`) — e a leitura da coluna é fail-closed
 * (`normalizeConversationOrigin`, `@hm/shared`: NULL/desconhecido = `sem-origem`).
 *
 * Aqui ela vira o conjunto de valores que o UPDATE condicional aceita, para a
 * trava ser atômica no Postgres (`... WHERE origin IN (...)`): não existe janela
 * entre "li a origem" e "liguei a IA".
 */
import { isAiEligibleOrigin, type ConversationOrigin } from '@hm/channels';
import {
  CONVERSATION_ORIGINS,
  normalizeConversationOrigin,
  type ConversationOriginValue,
} from '@hm/shared';

/**
 * Compile-time: o domínio persistido (`@hm/shared`) e o classificado
 * (`@hm/channels`) são o MESMO conjunto. Se alguém acrescentar uma origem de um lado
 * só, o build quebra aqui antes de a trava deixar passar (ou barrar) algo por engano.
 */
type SameOriginDomain = [ConversationOrigin] extends [ConversationOriginValue]
  ? [ConversationOriginValue] extends [ConversationOrigin]
    ? true
    : false
  : false;
const originDomainsMatch: SameOriginDomain = true;
void originDomainsMatch;

/** Origens com que a IA pode ser ligada automaticamente. */
export const AI_ELIGIBLE_CONVERSATION_ORIGINS: readonly ConversationOriginValue[] =
  CONVERSATION_ORIGINS.filter((o) => isAiEligibleOrigin(o));

/** A conversa com esta `origin` (valor cru do banco) pode ter a IA ligada? */
export function isConversationAiEligible(rawOrigin: unknown): boolean {
  return isAiEligibleOrigin(normalizeConversationOrigin(rawOrigin));
}
