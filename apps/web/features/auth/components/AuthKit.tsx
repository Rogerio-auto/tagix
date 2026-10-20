'use client';

import type { ReactNode } from 'react';
import { Component, createRef, useEffect, useRef } from 'react';
import { cn } from '@hm/ui';
import { useCompanionAnchor } from '@/features/auth/companion';

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
  // Âncora do posto `heading` do companheiro: ele fica em pé na linha do eyebrow, medido
  // por ref (nunca por coordenada fixa). Só posição; nenhum texto do título sai daqui.
  const anchorRef = useCompanionAnchor<HTMLElement>('heading');
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: false });
  }, [focusOnMount]);

  return (
    <header ref={anchorRef} className="mb-8 flex flex-col gap-3">
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

export interface AuthStepTransitionProps {
  /** Identifica a etapa. Quando muda, o bloco antigo sai e o novo entra. */
  stepKey: string;
  children: ReactNode;
}

const STEP_EXIT_MS = 160;
const STEP_ENTER_MS = 240;
const STEP_REDUCED_MS = 120;

/**
 * Esvazia os campos de um clone do formulário: o fantasma só leva a FORMA dos campos, nunca o
 * que a pessoa digitou (nem a senha). `cloneNode` copia o VALOR ATUAL e a flag de "editado" do
 * input (não só o atributo `value`), então remover o atributo não basta: zera a propriedade
 * `value` também. `name` sai para que o clone nunca seja tratado como campo do formulário.
 */
export function scrubGhostFields(root: ParentNode): void {
  root.querySelectorAll('input, textarea').forEach((el) => {
    el.removeAttribute('value');
    el.removeAttribute('name');
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = '';
  });
}

/** Lê a curva do token (`--ease`, `--ease-spring`): a fonte é `@hm/design-tokens`, não este arquivo. */
function readEasing(el: Element, token: '--ease' | '--ease-spring'): string {
  const value = getComputedStyle(el).getPropertyValue(token).trim();
  return value === '' ? 'ease-out' : value;
}

/**
 * Troca de etapa na MESMA rota (cadastro -> "Verifique seu email", verificação em curso ->
 * sucesso): o bloco novo monta na hora e entra com fade + blur curto; o bloco antigo sai
 * como um FANTASMA (clone inerte do DOM, sobreposto e fora do fluxo).
 *
 * Por que fantasma e não "segurar" o bloco antigo: segurar adiaria a montagem do novo e,
 * com ela, o `focusOnMount` do H1 (WCAG 2.4.3). O fantasma não toma o foco, não muda a
 * altura da coluna (zero layout shift) e não roda efeito nenhum. Blur só neste bloco.
 *
 * Entrada: opacity, blur 4->0, translateY 4->0 em 240 ms `--ease-spring`.
 * Saída: opacity ->0 e blur 0->4 px em 160 ms `--ease`.
 * Movimento reduzido: só opacity, 120 ms.
 *
 * É classe porque `getSnapshotBeforeUpdate` é a única janela em que o DOM antigo ainda
 * existe e o novo ainda não foi aplicado; hooks não têm equivalente.
 */
export class AuthStepTransition extends Component<AuthStepTransitionProps> {
  private readonly contentRef = createRef<HTMLDivElement>();
  private readonly ghostRef = createRef<HTMLDivElement>();

  override getSnapshotBeforeUpdate(prev: AuthStepTransitionProps): HTMLElement | null {
    const content = this.contentRef.current;
    if (prev.stepKey === this.props.stepKey || !content) return null;
    const clone = content.cloneNode(true);
    return clone instanceof HTMLElement ? clone : null;
  }

  override componentDidUpdate(prev: AuthStepTransitionProps, _state: unknown, ghost: HTMLElement | null) {
    if (prev.stepKey === this.props.stepKey) return;
    const content = this.contentRef.current;
    const host = this.ghostRef.current;
    if (!content || typeof content.animate !== 'function') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      content.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: STEP_REDUCED_MS,
        easing: readEasing(content, '--ease'),
      });
    } else {
      content.animate(
        [
          { opacity: 0, filter: 'blur(4px)', transform: 'translateY(4px)' },
          { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
        ],
        { duration: STEP_ENTER_MS, easing: readEasing(content, '--ease-spring') },
      );
    }

    if (!ghost || !host) return;
    // O fantasma é só pixel: sem ids duplicados, sem iframe (o captcha recarregaria), sem foco.
    ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    ghost.querySelectorAll('iframe, script, video, audio').forEach((n) => n.remove());
    scrubGhostFields(ghost);
    ghost.setAttribute('inert', '');
    host.appendChild(ghost);
    const out = ghost.animate(
      reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, filter: 'blur(0px)' },
            { opacity: 0, filter: 'blur(4px)' },
          ],
      {
        duration: reduced ? STEP_REDUCED_MS : STEP_EXIT_MS,
        easing: readEasing(content, '--ease'),
        fill: 'forwards',
      },
    );
    const cleanup = () => ghost.remove();
    out.addEventListener('finish', cleanup, { once: true });
    out.addEventListener('cancel', cleanup, { once: true });
  }

  override render() {
    return (
      <div className="relative">
        <div
          ref={this.ghostRef}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10"
        />
        <div ref={this.contentRef}>{this.props.children}</div>
      </div>
    );
  }
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
