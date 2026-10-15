/**
 * Homônimos da lista de conversas (F72-S05).
 *
 * Quando dois ou mais contatos aparecem com o mesmo nome, o telefone vira a segunda
 * linha de todos eles: é o que os diferencia. A comparação usa o rótulo visível
 * (o mesmo de `contactLabel`), sem caixa e sem espaços nas pontas.
 */
import { channelOf, contactLabel } from '../../contact-label';
import type { ConversationSummary } from '../../types';

type HomonymInput = Pick<
  ConversationSummary,
  'id' | 'contactDisplayName' | 'contactProfileName' | 'remoteId' | 'kind' | 'channelProvider'
>;

export function homonymIds(conversations: readonly HomonymInput[]): Set<string> {
  const keyOf = (c: HomonymInput): string | null => {
    const who = contactLabel({
      displayName: c.contactDisplayName,
      profileName: c.contactProfileName,
      remoteId: c.remoteId,
      channel: channelOf(c) ?? c.kind,
    });
    // Sem nome, o título já é o telefone/identificador: não há o que desempatar.
    return who.named ? who.label.trim().toLocaleLowerCase() : null;
  };
  const keys = conversations.map(keyOf);
  const count = new Map<string, number>();
  for (const k of keys) if (k !== null) count.set(k, (count.get(k) ?? 0) + 1);
  const ids = new Set<string>();
  conversations.forEach((c, i) => {
    const k = keys[i];
    if (k !== null && k !== undefined && (count.get(k) ?? 0) > 1) ids.add(c.id);
  });
  return ids;
}
