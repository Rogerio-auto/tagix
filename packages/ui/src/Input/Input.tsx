import type { InputHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '../lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: InputSize;
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3 text-sm',
  lg: 'h-12 px-4 text-base',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, size = 'md', id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  const hasError = Boolean(error);
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="font-head text-sm font-medium text-text-mid">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={message ? descId : undefined}
        className={cn(
          'w-full rounded-sm border bg-surface-inset font-body text-text outline-none',
          'placeholder:text-text-low transition-[color,border-color,box-shadow] duration-200',
          'border-border hover:border-border-2',
          'focus:border-brand focus:shadow-glow-sm',
          'disabled:cursor-not-allowed disabled:opacity-40',
          hasError && 'border-danger focus:border-danger focus:shadow-none',
          sizeClasses[size],
          className,
        )}
        {...props}
      />
      {message && (
        <span
          id={descId}
          // Erro de validação é anunciado por leitor de tela assim que aparece
          // (UX §2.7 — feedback de ação). Hint comum permanece estático.
          role={hasError ? 'alert' : undefined}
          aria-live={hasError ? 'assertive' : undefined}
          className={cn('text-sm', hasError ? 'text-danger' : 'text-text-low')}
        >
          {message}
        </span>
      )}
    </div>
  );
});
