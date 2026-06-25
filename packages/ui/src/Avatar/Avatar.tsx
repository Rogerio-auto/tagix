'use client';

/**
 * Avatar — primitivo do Design System v2 (F48-S04).
 *
 * Renderiza a foto (`src`) quando disponível e cai num fallback de **iniciais**
 * num círculo (estilo da ChatList) quando não há foto ou a imagem falha ao
 * carregar. Reutilizável por leaderboard, leads recentes e, no futuro, pela
 * própria ChatList.
 *
 * UX:
 *  - §3.6 — nunca mostra quadro quebrado: `onError` cai instantaneamente nas
 *    iniciais (fallback sem flash de imagem partida).
 *  - §3.5 — apresentacional por padrão (não clicável); cursor/hover ficam a
 *    cargo do consumidor que o tornar interativo.
 *  - §8 (mobile) — tamanhos em múltiplos de 4 (24/40/56px).
 *
 * DS v2: zero hex hardcoded, tokens semânticos (`bg-surface-3`, `text-text-mid`).
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { cn } from '../lib/cn';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** URL da foto. Quando ausente/inválida, renderiza as iniciais. */
  src?: string | null;
  /** Nome usado para derivar as iniciais e o rótulo acessível. */
  name?: string | null;
  /** sm=24px · md=40px (casa com a ChatList) · lg=56px. */
  size?: AvatarSize;
  className?: string;
}

/** Dimensão do círculo por tamanho — múltiplos de 4 (24/40/56px). */
const dimensionClasses: Record<AvatarSize, string> = {
  sm: 'size-6',
  md: 'size-10',
  lg: 'size-14',
};

/** Tamanho do texto das iniciais por tamanho do avatar. */
const textClasses: Record<AvatarSize, string> = {
  sm: 'text-[10px]',
  md: 'text-sm',
  lg: 'text-lg',
};

/** Deriva até 2 iniciais (primeira + última palavra), maiúsculas. */
function initialsFrom(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';

  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const derived = `${first}${last}` || trimmed.slice(0, 2);

  return derived.slice(0, 2).toUpperCase();
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps): ReactElement {
  const [failed, setFailed] = useState(false);
  const label = name?.trim() ? name.trim() : undefined;
  const showImage = Boolean(src) && !failed;

  if (showImage) {
    return (
      <img
        src={src ?? ''}
        alt={label ?? ''}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-pill object-cover', dimensionClasses[size], className)}
      />
    );
  }

  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-pill bg-surface-3 font-head text-text-mid',
        dimensionClasses[size],
        textClasses[size],
        className,
      )}
    >
      <span aria-hidden>{initialsFrom(name)}</span>
    </span>
  );
}
