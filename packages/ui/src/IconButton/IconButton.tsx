import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

const iconButtonVariants = cva(
  [
    // `relative` + pseudo-alvo garantem área de toque ≥40px mesmo no tamanho `sm`
    // (WCAG 2.5.8 / DESIGN_SYSTEM §6): o clique vale no ::before invisível.
    'relative inline-flex shrink-0 items-center justify-center rounded-md',
    "before:absolute before:left-1/2 before:top-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
    'outline-none transition-[color,background-color,box-shadow] duration-200 ease-out',
    // Foco de teclado SEMPRE visível — o pecado que a auditoria apontou em 34 arquivos.
    'focus-visible:shadow-glow-md active:scale-[0.96]',
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        ghost: 'bg-transparent text-text-low hover:bg-surface-2 hover:text-text',
        solid: 'bg-surface-2 text-text hover:bg-surface-3',
        danger: 'bg-transparent text-text-low hover:bg-danger/10 hover:text-danger',
        link: 'bg-transparent text-text-low hover:text-brand',
      },
      size: {
        // O quadrado é o alvo visual; o ::before completa 40px quando menor.
        sm: 'size-8 [&_svg]:size-4',
        md: 'size-10 [&_svg]:size-5',
        lg: 'size-12 [&_svg]:size-6',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export type IconButtonVariant = NonNullable<VariantProps<typeof iconButtonVariants>['variant']>;
export type IconButtonSize = NonNullable<VariantProps<typeof iconButtonVariants>['size']>;

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>,
    VariantProps<typeof iconButtonVariants> {
  /**
   * Rótulo acessível OBRIGATÓRIO — botão-ícone não tem texto visível, então o
   * leitor de tela depende disto (WCAG 4.1.2). Sem default: o TS força passar.
   */
  'aria-label': string;
  /** Ícone a renderizar (ex.: `<Trash2 />`). Tamanho é controlado pelo `size`. */
  icon: ReactNode;
  /** Mostra spinner e bloqueia o clique (UX §2.7 — sem clique-fantasma). */
  loading?: boolean;
}

/**
 * Botão-ícone acessível do DS v2. Foco de teclado visível, `aria-label`
 * obrigatório e área de toque ≥40px. Primitivo de referência para substituir
 * os `<button>` crus sem `focus-visible` apontados na auditoria (§3.9).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, icon, loading = false, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* Ícone é decorativo: o nome acessível vem do aria-label do botão (WCAG 1.1.1). */}
      <span className="inline-flex" aria-hidden>
        {loading ? <Loader2 className="animate-spin" /> : icon}
      </span>
    </button>
  );
});
