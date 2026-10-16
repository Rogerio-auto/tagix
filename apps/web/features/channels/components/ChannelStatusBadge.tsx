import { StatusPill, type BadgeTone } from '@hm/ui';
import type { Channel } from '../types';

/**
 * Status visível do canal. WAHA desautorizado (sessão derrubada do lado do
 * WhatsApp) é sinalizado pela ausência de `wahaSessionId` num canal WAHA — a
 * DoD pede "WAHA deauth visível". Demais canais: ativo vs. desativado.
 *
 * DS 3.0 (F72-S07): `StatusPill` do `@hm/ui`. "Conectado" é estado vivo (a conexão está
 * de pé), então o ponto pulsa — estático sob `prefers-reduced-motion`.
 */
function resolveStatus(channel: Channel): { label: string; tone: BadgeTone; live: boolean } {
  if (channel.provider === 'waha' && !channel.wahaSessionId) {
    return { label: 'Desautorizado', tone: 'warning', live: false };
  }
  if (!channel.isActive) return { label: 'Desativado', tone: 'neutral', live: false };
  return { label: 'Conectado', tone: 'success', live: true };
}

export function ChannelStatusBadge({ channel }: { channel: Channel }) {
  const { label, tone, live } = resolveStatus(channel);
  return (
    <StatusPill tone={tone} live={live} size="sm">
      {label}
    </StatusPill>
  );
}
