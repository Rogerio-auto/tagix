'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@hm/ui';

/**
 * Peças visuais das telas de acesso (DS 3.0, F72-S08): título editorial, avisos em
 * três partes e as classes de link. Só apresentação: nenhuma regra de autenticação
 * mora aqui.
 */

export interface AuthHeadingProps {
  /** Rótulo de contexto em mono, acima do título ("Acesso", "Nova conta"). */
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  /**
   * Move o foco para o título ao montar. Usado quando a MESMA rota troca de estado
   * (cadastro → "Verifique seu email"): o leitor de tela anuncia a tela nova em vez de
   * ficar parado num botão que sumiu (WCAG 2.4.3).
   */
  focusOnMount?: boolean;
}

export function AuthHeading({ eyebrow, title, lead, focusOnMount = false }: AuthHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: false });
  }, [focusOnMount]);

  return (
    <header className="mb-8 flex flex-col gap-3">
      <p className="flex items-center gap-2.5 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low">
        <span aria-hidden className="h-px w-5 bg-border-2" />
        {eyebrow}
      </p>
      <h1
        ref={ref}
        tabIndex={focusOnMount ? -1 : undefined}
        className="font-head text-h3 text-balance text-text outline-none lg:text-h2"
      >
        {title}
      </h1>
      {lead && <p className="font-body text-body text-pretty text-text-mid">{lead}</p>}
    </header>
  );
}

export type NoticeTone = 'danger' | 'warn' | 'info' | 'success' | 'neutral';

const NOTICE_TONE: Record<NoticeTone, { box: string; icon: string }> = {
  danger: { box: 'border-danger/30 bg-danger/10', icon: 'text-danger' },
  warn: { box: 'border-warn/30 bg-warn/10', icon: 'text-warn' },
  info: { box: 'border-info/30 bg-info/10', icon: 'text-info' },
  success: { box: 'border-success/30 bg-success/10', icon: 'text-success' },
  neutral: { box: 'border-border bg-surface-2', icon: 'text-text-mid' },
};

export interface AuthNoticeProps {
  tone: NoticeTone;
  /** Ícone lucide já com `aria-hidden` (a cor vem do tom). */
  icon: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

/**
 * Aviso em três partes (UX §2.11): o quê (título), por quê e o que fazer (texto). Cor
 * nunca sozinha (WCAG 1.4.1): o ícone e o título dizem o mesmo que o tom.
 */
export function AuthNotice({ tone, icon, title, children, role, className }: AuthNoticeProps) {
  const t = NOTICE_TONE[tone];
  return (
    <div role={role} className={cn('flex gap-3 rounded-md border px-4 py-3.5', t.box, className)}>
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-5', t.icon)}>{icon}</span>
      <div className="flex min-w-0 flex-col gap-1">
        {title && <p className="font-body text-sm font-bold text-text">{title}</p>}
        {children && <div className="font-body text-sm text-text-mid">{children}</div>}
      </div>
    </div>
  );
}

/** Link discreto de rodapé de formulário ("Voltar ao login"), com alvo de toque de 44px. */
export const quietLinkClass =
  'touch-target inline-flex items-center justify-center rounded-xs px-2 font-body text-sm font-semibold text-text-mid outline-none transition-colors duration-(--dur-fast) ease-ds hover:text-text focus-visible:focus-ring';

/** Link dentro de uma frase ("Não tem conta? Criar conta"). */
export const inlineLinkClass =
  'rounded-xs font-bold text-text underline decoration-border-2 underline-offset-4 outline-none transition-colors duration-(--dur-fast) ease-ds hover:decoration-brand-text focus-visible:focus-ring';

/**
 * Link com cara de botão primário (mesma receita do `Button` do `@hm/ui`): é a ação
 * única da tela quando ela navega em vez de enviar.
 */
export const primaryLinkClass =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-brand px-6 font-body text-base font-bold text-text-on-brand shadow-glow outline-none transition-[background-color,transform,box-shadow] duration-(--dur-base) ease-ds hover:bg-brand-bright focus-visible:focus-ring motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0';

/** Link com cara de botão secundário. */
export const secondaryLinkClass =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm border border-border bg-surface-2 px-6 font-body text-base font-bold text-text outline-none transition-[background-color,border-color,transform] duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-3 focus-visible:focus-ring motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0';
