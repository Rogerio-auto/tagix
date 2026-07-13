'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export type NoticeTone = 'info' | 'warn' | 'danger';

const TONE_SHELL: Record<NoticeTone, string> = {
  info: 'border-border-2 bg-surface-inset',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-danger/40 bg-danger/10',
};

const TONE_ICON: Record<NoticeTone, string> = {
  info: 'text-text-mid',
  warn: 'text-warn',
  danger: 'text-danger',
};

const TONE_GLYPH: Record<NoticeTone, typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  danger: OctagonAlert,
};

export interface InlineNoticeProps {
  tone?: NoticeTone;
  /** O QUÊ aconteceu (UX §2.11). Opcional em avisos meramente informativos. */
  title?: string;
  /** POR QUÊ + O QUE FAZER. */
  children: ReactNode;
  /** Ações de recuperação — sempre visíveis, nunca escondidas atrás de um toast. */
  actions?: ReactNode;
  /** Detalhe técnico (ex.: envs ausentes) para abrir chamado no suporte. */
  detail?: string;
  className?: string;
}

/**
 * Aviso ancorado no fluxo (não um toast que some): o erro fica ao lado do controle
 * que falhou, com o caminho de saída junto. `role="alert"` nos tons de erro para o
 * leitor de tela anunciar a falha assim que ela aparece.
 */
export function InlineNotice({
  tone = 'info',
  title,
  children,
  actions,
  detail,
  className,
}: InlineNoticeProps) {
  const Glyph = TONE_GLYPH[tone];
  return (
    <div
      role={tone === 'info' ? undefined : 'alert'}
      className={cn('flex gap-2.5 rounded-md border px-3 py-2.5', TONE_SHELL[tone], className)}
    >
      <Glyph className={cn('mt-0.5 size-4 shrink-0', TONE_ICON[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-head text-sm font-semibold text-text">{title}</p>}
        <div className={cn('font-body text-xs text-text-low', title && 'mt-1')}>{children}</div>
        {detail && <p className="mt-1.5 break-words font-price text-xs text-text-low">{detail}</p>}
        {actions && <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
