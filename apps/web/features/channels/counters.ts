/**
 * Contador da seção "Canais" da sidebar de Configurações (F56-S05 — UX-06).
 *
 * O bug antigo lia `channel.status === 'active'`, campo que o payload público de
 * `GET /api/channels` **nunca** teve (`PUBLIC_CHANNEL_COLUMNS` expõe `isActive`)
 * — o badge dizia "0 ativos" com o WhatsApp ligado, mentindo justo no ponto de
 * maior ansiedade do onboarding. A lógica agora deriva de `Channel` (o mesmo tipo
 * que a lista usa), então um drift futuro da API quebra no typecheck, não em prod.
 *
 * O antigo bloco de "expirando" lia `tokenExpiresAt`, que também não vem no
 * payload público: foi retirado. No lugar entram sinais que **existem** — canal
 * WAHA desautorizado (sessão derrubada) e "nenhum canal ativo" — os dois casos em
 * que nada entra no inbox e o usuário precisa ser avisado.
 */

import type { Channel } from './types';

/** Subconjunto do canal de que o contador depende (contrato mínimo, sem drift). */
export type ChannelCounterRow = Pick<Channel, 'provider' | 'isActive' | 'wahaSessionId'>;

export interface ChannelsSummary {
  readonly label: string;
  /** `true` pinta o contador como alerta (nada entra no inbox / sessão caiu). */
  readonly alert: boolean;
}

/** Canal WAHA sem sessão = sessão derrubada do lado do WhatsApp (mesma regra do badge da lista). */
function isDeauthorized(c: ChannelCounterRow): boolean {
  return c.provider === 'waha' && !c.wahaSessionId;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Resume os canais para o badge da sidebar. Sem canais → `null` (omissão honesta:
 * quem não tem canal vê o empty state da própria seção, não um "0 ativos").
 */
export function summarizeChannels(rows: readonly ChannelCounterRow[]): ChannelsSummary | null {
  if (rows.length === 0) return null;

  const active = rows.filter((c) => c.isActive).length;
  const deauthorized = rows.filter((c) => c.isActive && isDeauthorized(c)).length;
  const inactive = rows.length - active;

  const parts: string[] = [plural(active, 'ativo', 'ativos')];
  if (deauthorized > 0) {
    parts.push(plural(deauthorized, 'desautorizado', 'desautorizados'));
  } else if (inactive > 0) {
    parts.push(plural(inactive, 'inativo', 'inativos'));
  }

  return {
    label: parts.join(' · '),
    // Alerta = o inbox está (ou pode estar) sem entrada: nenhum canal ativo, ou
    // sessão WAHA caída num canal que deveria estar recebendo.
    alert: active === 0 || deauthorized > 0,
  };
}
