/**
 * Avatar do contato (F72-S05).
 *
 * - Com nome: iniciais (até 2 letras) em `font-head`.
 * - Sem nome: ícone de pessoa. Nunca `#` nem pedaço de telefone.
 * - Cor determinística por contato (`avatarTone`), de um conjunto fechado de tokens.
 *
 * Decorativo: o nome do contato já está no texto ao lado, então o avatar fica `aria-hidden`.
 */

import { User } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { avatarTone, type ContactLabel } from '../contact-label';

// Raio ~30% do lado (maquete: avatar 26px / raio 8px): quadrado suave, não círculo.
const SIZES = {
  sm: 'size-8 rounded-sm text-xs',
  md: 'size-10 rounded-md text-sm',
  lg: 'size-12 rounded-md text-base',
} as const;

const ICON_SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-6' } as const;

export interface ContactAvatarProps {
  who: Pick<ContactLabel, 'named' | 'initials'>;
  /** Chave estável do contato (id; na falta, o remoteId) — define a cor. */
  colorKey: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function ContactAvatar({ who, colorKey, size = 'md', className }: ContactAvatarProps) {
  return (
    <span
      aria-hidden
      data-avatar-tone={avatarTone(colorKey)}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-head font-semibold',
        SIZES[size],
        avatarTone(colorKey),
        className,
      )}
    >
      {who.named ? who.initials : <User className={ICON_SIZES[size]} aria-hidden />}
    </span>
  );
}
