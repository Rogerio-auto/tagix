import type {
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Primitives de formulário do wizard que faltam em `@hm/ui` (Select/Textarea/
 * Toggle/Field). Estilizados com tokens DS v2 espelhando o `Input` de @hm/ui —
 * zero hex hardcoded. Locais ao wizard de propósito (não são API de design system).
 */

/** Wrapper de campo com label + mensagem (erro tem precedência sobre hint). */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | null;
  error?: string;
  children: ReactNode;
}) {
  const descId = `${id}-desc`;
  const message = error ?? hint ?? undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-head text-sm font-medium text-text-mid">
        {label}
      </label>
      {children}
      {message && (
        <span id={descId} className={cn('text-sm', error ? 'text-danger' : 'text-text-low')}>
          {message}
        </span>
      )}
    </div>
  );
}

const controlClasses = (hasError: boolean) =>
  cn(
    'w-full rounded-sm border bg-surface-inset font-body text-text outline-none',
    'placeholder:text-text-low transition-[color,border-color,box-shadow] duration-200',
    'border-border hover:border-border-2',
    'focus:border-brand focus:shadow-glow-sm',
    'disabled:cursor-not-allowed disabled:opacity-40',
    hasError && 'border-danger focus:border-danger focus:shadow-none',
  );

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, error = false, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={error || undefined}
      className={cn(controlClasses(error), 'px-3 py-2 text-sm', className)}
      {...props}
    />
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectFieldProps>(function Select(
  { className, error = false, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(controlClasses(error), 'h-10 px-3 text-sm', className)}
      {...props}
    >
      {children}
    </select>
  );
});

/** Toggle acessível (checkbox visualmente switch). */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill outline-none',
          'transition-colors duration-200 focus-visible:shadow-glow-md',
          checked ? 'bg-brand' : 'bg-surface-3',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-4 rounded-pill bg-text-on-brand transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-1',
          )}
        />
      </button>
      <span className="font-body text-sm text-text">{label}</span>
    </label>
  );
}
