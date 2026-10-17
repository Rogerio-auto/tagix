/**
 * Peças comuns das consultas de operação do Copiloto (F73-S07).
 *
 * O resto (recorte, `not_found`, telefone mascarado, formato do workspace, limites) vem do
 * read-crm (S06) por import: um só lugar para cada régua.
 */
import { maskPhone } from '../read-crm/common';

/** Família do canal pelo provider (a mesma regra de `channelOf` da inbox). */
export type ChannelFamily = 'whatsapp' | 'instagram';

export const CHANNEL_PROVIDERS: Readonly<Record<ChannelFamily, readonly string[]>> = {
  whatsapp: ['meta_whatsapp', 'waha'],
  instagram: ['meta_instagram'],
};

export function channelFamily(provider: string | null | undefined): ChannelFamily | null {
  const v = (provider ?? '').toLowerCase();
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('whatsapp') || v === 'waha') return 'whatsapp';
  return null;
}

/** Rótulo do canal para cartão e modelo ("WhatsApp", "Instagram"). */
export function channelLabel(provider: string | null | undefined): string {
  const family = channelFamily(provider);
  if (family === 'whatsapp') return 'WhatsApp';
  if (family === 'instagram') return 'Instagram';
  return 'Canal';
}

/**
 * Nome de exibição do contato no CARTÃO, na hierarquia da inbox (`contact-label.ts`, F70-S37):
 * nome no sistema → nome do perfil → identificador do canal. Diferença deliberada: sem nome,
 * o telefone sai MASCARADO (o cartão do Copiloto nunca mostra o número inteiro, S06).
 * Conversa de grupo usa o nome do grupo.
 */
export function contactDisplayName(input: {
  readonly displayName: string | null;
  readonly profileName: string | null;
  readonly remoteId: string | null;
  readonly provider: string | null;
  readonly groupName?: string | null;
}): string {
  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim().replace(/\s+/g, ' ');
    return t === '' ? null : t;
  };
  const named = clean(input.displayName) ?? clean(input.profileName) ?? clean(input.groupName);
  if (named !== null) return named;
  const remote = clean(input.remoteId) ?? '';
  if (channelFamily(input.provider) === 'instagram') {
    return remote.startsWith('@') && remote.length > 1 ? remote : 'Contato do Instagram';
  }
  return maskPhone(remote) ?? 'Contato sem número';
}

/** Minutos inteiros entre `from` e `now` (nunca negativo). */
export function minutesSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
}
