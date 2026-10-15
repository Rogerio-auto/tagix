import type {
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef } from 'react';
import { Switch } from '@hm/ui';
import { cn } from '@/shared/lib/cn';

/**
 * Primitives de formulário do wizard que faltam em `@hm/ui` (Select/Textarea/Field),
 * no desenho do `Input` do DS 3.0 (F72-S07) — zero hex. O `Toggle` delega ao `Switch`
 * do `@hm/ui`. Locais aos agentes de propósito (não são API de design system).
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
      <label htmlFor={id} className="font-body text-sm font-bold text-text-mid">
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
    'w-full rounded-sm border bg-surface-2 font-body text-base text-text outline-none sm:text-sm',
    'placeholder:text-text-low transition-[color,border-color,box-shadow] duration-(--dur-base) ease-ds',
    'border-border hover:border-border-2',
    'focus:border-brand-text focus-visible:focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-60',
    hasError && 'border-danger focus:border-danger',
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
      className={cn(controlClasses(error), 'px-3 py-2', className)}
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
      className={cn(controlClasses(error), 'h-10 px-3', className)}
      {...props}
    >
      {children}
    </select>
  );
});

/** Toggle acessível: o `Switch` do DS 3.0 com a assinatura antiga (`onChange`). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  loading = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Switch checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} loading={loading} />
  );
}
