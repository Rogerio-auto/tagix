import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, HelpCircle, X } from 'lucide-react';
import { cn } from '../lib/cn';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface HelpLink {
  /** Texto do link "saiba mais". */
  label: string;
  href: string;
}

export interface HelpContent {
  /** Título da seção de ajuda. */
  title: string;
  /** Corpo rico: parágrafos, listas, exemplos. Nunca cabe em 1 linha (anti §2.5). */
  body: ReactNode;
  /** Link opcional para a doc completa. */
  link?: HelpLink;
}

export interface HelpHintProps extends HelpContent {
  /**
   * `aria-label` do gatilho `?`. Default: `Ajuda: ${title}`.
   * Use quando o título sozinho não der contexto suficiente para leitor de tela.
   */
  triggerLabel?: string;
  className?: string;
}

/**
 * `HelpPanel` — drawer lateral persistente (direita) com conteúdo rico de ajuda.
 *
 * UX §3.2 / §2.3: drawer lateral, NUNCA modal cobre-tudo. Mantém o contexto da
 * tela visível atrás (~40%). UX §2.5: ajuda REAL (título + corpo + link), nunca
 * tooltip de 1 linha. Fecha com Esc, X ou clique fora (§2.10).
 *
 * Self-contained no DS: recebe conteúdo por prop; o registry tipado mora no app.
 */
export function HelpPanel({
  open,
  onClose,
  title,
  body,
  link,
}: {
  open: boolean;
  onClose: () => void;
} & HelpContent) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Foca o painel ao abrir para o fluxo de teclado começar dentro dele (§2.10).
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const trapTab = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        className={cn(
          'absolute inset-y-0 right-0 flex w-[440px] max-w-full flex-col border-l border-border bg-surface shadow-elev-4',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-2 px-5 py-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="size-5 shrink-0 text-text-mid" aria-hidden />
            <h2 id={titleId} className="font-head text-lg font-semibold text-text">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ajuda"
            className="rounded-sm p-1 text-text-low outline-none transition-colors duration-200 hover:text-text focus-visible:shadow-glow-md"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="font-body text-sm leading-relaxed text-text-mid [&_a]:text-brand [&_a]:underline-offset-4 [&_a:hover]:underline [&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-price [&_code]:text-text [&_li]:ml-4 [&_li]:list-disc [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-text [&_ul]:mt-2 [&_ul]:space-y-1">
            {body}
          </div>
        </div>

        {link && (
          <div className="border-t border-border-2 px-5 py-4">
            <a
              href={link.href}
              className="inline-flex items-center gap-1.5 rounded-sm font-head text-sm font-semibold text-brand outline-none transition-colors duration-150 hover:text-brand-strong focus-visible:shadow-glow-md"
            >
              {link.label}
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}

/**
 * `HelpHint` — gatilho `?` inline (DS v2) que abre um {@link HelpPanel} lateral.
 *
 * Inserir ao lado do nome de uma seção/feature. UX §2.4: `?` SEMPRE visível, com
 * hover/focus state claro — nunca caça ao tesouro. UX §3.5: cursor/hover ensinam.
 * Acessível por teclado: gatilho é `<button>`, painel fecha com Esc (§2.10).
 */
export function HelpHint({ triggerLabel, className, ...content }: HelpHintProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel ?? `Ajuda: ${content.title}`}
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-pill text-text-low outline-none',
          'transition-colors duration-150 hover:bg-surface-2 hover:text-text',
          'focus-visible:shadow-glow-md',
          className,
        )}
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} {...content} />
    </>
  );
}
