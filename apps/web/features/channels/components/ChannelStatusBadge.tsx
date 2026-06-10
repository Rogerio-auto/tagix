import { cn } from '@/shared/lib/cn';
import type { Channel } from '../types';

/**
 * Status visível do canal. WAHA desautorizado (sessão derrubada do lado do
 * WhatsApp) é sinalizado pela ausência de `wahaSessionId` num canal WAHA — a
 * DoD pede "WAHA deauth visível". Demais canais: ativo vs. desativado.
 */
function resolveStatus(channel: Channel): { label: string; tone: 'ok' | 'off' | 'warn' } {
  if (channel.provider === 'waha' && !channel.wahaSessionId) {
    return { label: 'Desautorizado', tone: 'warn' };
  }
  if (!channel.isActive) return { label: 'Desativado', tone: 'off' };
  return { label: 'Conectado', tone: 'ok' };
}

const toneClass: Record<'ok' | 'off' | 'warn', string> = {
  ok: 'bg-success/15 text-success',
  off: 'bg-surface-3 text-text-low',
  warn: 'bg-warn/15 text-warn',
};

const dotClass: Record<'ok' | 'off' | 'warn', string> = {
  ok: 'bg-success',
  off: 'bg-text-low',
  warn: 'bg-warn',
};

export function ChannelStatusBadge({ channel }: { channel: Channel }) {
  const { label, tone } = resolveStatus(channel);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-head text-xs font-medium',
        toneClass[tone],
      )}
    >
      <span className={cn('size-1.5 rounded-pill', dotClass[tone])} aria-hidden />
      {label}
    </span>
  );
}
