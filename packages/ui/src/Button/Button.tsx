import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-sm border border-transparent font-body font-bold',
    'outline-none transition-[color,background-color,border-color,transform,box-shadow] duration-(--dur-base) ease-ds',
    // Lift no hover (DS 3.0 §05) e press < 200ms; ambos só com movimento permitido.
    'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.985]',
    'focus-visible:focus-ring',
    'disabled:cursor-not-allowed disabled:not-aria-busy:opacity-40 disabled:pointer-events-none aria-busy:cursor-progress',
  ],
  {
    variants: {
      variant: {
        // CTA único por contexto (maquete §03): único com a marca cheia e o brilho de varredura.
        primary: [
          'bg-brand text-text-on-brand shadow-glow hover:bg-brand-bright',
          "after:pointer-events-none after:absolute after:inset-0 after:-translate-x-[130%] after:content-['']",
          'after:bg-[linear-gradient(110deg,transparent_20%,color-mix(in_oklab,var(--text-on-brand)_14%,transparent)_48%,transparent_74%)]',
          'motion-safe:after:transition-transform motion-safe:after:duration-500 motion-safe:after:ease-ds',
          'motion-safe:hover:after:translate-x-[130%]',
        ],
        secondary: 'border-border bg-surface-2 text-text hover:border-border-2 hover:bg-surface-3',
        ghost: 'bg-transparent text-text-mid hover:bg-surface-2 hover:text-text',
        // Destrutivo é "suave" (maquete): tinta + borda; o peso vem da confirmação (UX §2.9), não da cor chapada.
        danger: 'border-danger/25 bg-danger/10 text-danger hover:border-danger/40 hover:bg-danger/15',
        outline: 'border-border-2 bg-transparent text-text hover:border-border-brand hover:bg-surface-2',
        link: 'bg-transparent px-0 text-brand-text underline-offset-4 hover:underline motion-safe:hover:translate-y-0',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Mostra spinner inline e bloqueia o clique (UX §2.7 — sem click-fantasma). */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, leftIcon, rightIcon, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
