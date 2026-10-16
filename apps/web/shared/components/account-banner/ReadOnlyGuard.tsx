'use client';

import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { cloneElement, isValidElement, useId } from 'react';
import { cn } from '@/shared/lib/cn';
import { READ_ONLY_TOOLTIP, useIsReadOnly } from './useIsReadOnly';

/**
 * Botão de escrita em empresa só leitura (F71-S17, absorvido pela F72-S07).
 *
 * Regras de acessibilidade (por que não `disabled`):
 *  - o botão continua FOCÁVEL: `disabled` tira o elemento da ordem de tabulação e quem
 *    navega por teclado nunca descobre por que a ação não está disponível;
 *  - `aria-disabled="true"` anuncia o estado; o clique (mouse, Enter, Espaço, submit) é
 *    bloqueado por `preventDefault` no próprio `onClick`;
 *  - a explicação `READ_ONLY_TOOLTIP` é texto REAL no DOM, ligado por `aria-describedby`
 *    (leitor de tela lê junto com o nome) e visível ao passar o mouse ou focar.
 *
 * A guarda real é do servidor (402 `subscription_inactive`); aqui é só a UX honesta.
 * O `Button` do `@hm/ui` estiliza `disabled:`; o estado `aria-disabled` é pintado pela
 * classe `READ_ONLY_CLASS` (tokens, sem tocar o pacote).
 */

/** Estilo de "indisponível" para `aria-disabled` (o Button do @hm/ui só pinta `disabled:`). */
export const READ_ONLY_CLASS = cn(
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none',
  // Sem lift, sem varredura de brilho e sem troca de cor no hover: nada convida ao clique.
  'aria-disabled:hover:translate-y-0 aria-disabled:active:scale-100 aria-disabled:after:hidden',
);

export interface ReadOnlyActionProps<E extends HTMLElement = HTMLElement> {
  'aria-disabled'?: true;
  'aria-describedby'?: string;
  'data-read-only'?: true;
  onClick: (event: MouseEvent<E>) => void;
}

/**
 * Props da guarda para um elemento clicável. Pura (testável sem DOM): com `readOnly`
 * o clique é engolido e o elemento ganha `aria-disabled` + a descrição; sem, o
 * `onClick` original passa intacto.
 */
export function readOnlyActionProps<E extends HTMLElement = HTMLElement>(options: {
  readOnly: boolean;
  descriptionId: string;
  onClick?: ((event: MouseEvent<E>) => void) | undefined;
  /** `aria-describedby` que o elemento já tinha (é preservado). */
  describedBy?: string | undefined;
}): ReadOnlyActionProps<E> {
  const { readOnly, descriptionId, onClick, describedBy } = options;
  if (!readOnly) {
    return {
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      onClick: (event) => onClick?.(event),
    };
  }
  return {
    'aria-disabled': true,
    'aria-describedby': describedBy ? `${describedBy} ${descriptionId}` : descriptionId,
    'data-read-only': true,
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

type Align = 'start' | 'center' | 'end';

const alignClass: Record<Align, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

interface GuardableProps {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  className?: string;
  'aria-describedby'?: string;
}

export interface ReadOnlyGuardProps {
  /** UM elemento clicável (normalmente `<Button>`); recebe as props da guarda. */
  children: ReactElement<GuardableProps>;
  /** Força o estado (teste, story). Padrão: `useIsReadOnly()` da empresa ativa. */
  readOnly?: boolean;
  /** Onde a dica aparece em relação ao botão. Padrão `end` (ações ficam à direita). */
  align?: Align;
  /** Classe do invólucro (ex.: `w-full sm:w-auto` quando o botão ocupa a linha). */
  className?: string;
}

/**
 * Envolve um botão de escrita: fora do modo só leitura devolve o filho intacto; dentro,
 * aplica `aria-disabled`, bloqueia o clique e mostra a explicação ao hover/foco.
 *
 * ```tsx
 * <ReadOnlyGuard>
 *   <Button onClick={openCreate}>Novo contato</Button>
 * </ReadOnlyGuard>
 * ```
 */
export function ReadOnlyGuard({
  children,
  readOnly,
  align = 'end',
  className,
}: ReadOnlyGuardProps): ReactNode {
  const workspaceReadOnly = useIsReadOnly();
  const descriptionId = useId();
  const active = readOnly ?? workspaceReadOnly;

  if (!active || !isValidElement(children)) return children;

  const guard = readOnlyActionProps({
    readOnly: true,
    descriptionId,
    describedBy: children.props['aria-describedby'],
  });

  return (
    <span className={cn('group/ro relative inline-flex', className)} data-read-only-guard="">
      {cloneElement(children, {
        ...guard,
        className: cn(children.props.className, READ_ONLY_CLASS),
      })}
      <span
        id={descriptionId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full z-40 mt-2 w-max max-w-64 rounded-sm border border-border-2',
          'bg-bg-elevated px-3 py-2 text-left font-body text-xs font-medium leading-snug text-text shadow-ds-2',
          'opacity-0 transition-opacity duration-(--dur-fast) ease-ds motion-reduce:transition-none',
          'group-hover/ro:opacity-100 group-focus-within/ro:opacity-100',
          alignClass[align],
        )}
      >
        {READ_ONLY_TOOLTIP}
      </span>
    </span>
  );
}
