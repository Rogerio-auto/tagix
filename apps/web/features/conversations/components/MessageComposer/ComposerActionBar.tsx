'use client';

/**
 * Barra de ações do composer (F45-S03). Ponto de extensão central das modalidades
 * de envio do LiveChat: anexo + emoji hoje; voz (S04), sticker/localização (S05) e
 * contato (S07) entram só adicionando itens à lista `actions` — sem reescrever este
 * componente nem o `MessageComposer` (scaffold-then-fill, ver RICH_COMPOSER §4).
 *
 * UX: ações ricas ficam VISÍVEIS numa barra explícita (evita o anti-padrão
 * *gear-only entry*, UX §3); cada ação é um ícone `lucide` com tooltip + `aria-label`.
 * DS v2: zero hex, só tokens; alvo de toque ≥44px (`touch-target`); foco
 * `focus-visible:shadow-glow-md`.
 */

import { forwardRef, Fragment, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Item declarativo da barra. `node` é renderizado como está — ações simples usam
 * `<ComposerActionButton>`; ações com popover próprio (emoji, anexo) trazem o
 * trigger + popover encapsulados no seu `node`.
 */
export interface ComposerActionItem {
  /** Identidade estável para a key da lista. */
  readonly id: string;
  /** Conteúdo da ação (botão simples ou trigger+popover). */
  readonly node: ReactNode;
}

export interface ComposerActionBarProps {
  /** Lista declarativa de ações, da esquerda para a direita. */
  readonly actions: readonly ComposerActionItem[];
  readonly className?: string;
}

export function ComposerActionBar({ actions, className }: ComposerActionBarProps) {
  if (actions.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="Ações de mensagem"
      className={cn('flex items-center gap-0.5', className)}
    >
      {actions.map((action) => (
        <Fragment key={action.id}>{action.node}</Fragment>
      ))}
    </div>
  );
}

export interface ComposerActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Ícone (geralmente `lucide`) renderizado centralizado. */
  readonly icon: ReactNode;
  /** Rótulo acessível — vira `aria-label` e tooltip nativo (`title`). */
  readonly label: string;
  /** Realça o botão quando o popover associado está aberto. */
  readonly active?: boolean;
}

/**
 * Botão padrão da barra de ações: ícone-only, ≥44px de alvo, tooltip + `aria-label`.
 * `forwardRef` para que popovers ancorem/devolvam foco ao trigger.
 */
export const ComposerActionButton = forwardRef<HTMLButtonElement, ComposerActionButtonProps>(
  function ComposerActionButton({ icon, label, active = false, className, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        className={cn(
          'touch-target flex items-center justify-center rounded-md outline-none transition-colors',
          'hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md',
          'disabled:cursor-not-allowed disabled:opacity-40',
          active ? 'bg-surface-2 text-text' : 'text-text-mid',
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
