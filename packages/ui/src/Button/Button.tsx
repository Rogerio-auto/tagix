import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-head font-semibold',
    'outline-none transition-[color,background-color,transform,box-shadow] duration-200 ease-out',
    'focus-visible:shadow-glow-md active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-text-on-brand hover:bg-brand-strong',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3',
        ghost: 'bg-transparent text-text hover:bg-surface-2',
        danger: 'bg-danger text-white hover:brightness-110',
        outline: 'border border-border bg-transparent text-text hover:border-border-2 hover:bg-surface-2',
        link: 'bg-transparent px-0 text-brand underline-offset-4 hover:underline',
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
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
