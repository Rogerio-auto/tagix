import type { InputHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Ajuda persistente sob o campo (some quando há erro ou sucesso). */
  hint?: string;
  /** Mensagem de erro — vira `role="alert"` e `aria-invalid`. Tem precedência sobre `success`/`hint`. */
  error?: string;
  /** Mensagem de sucesso (ex.: "Domínio verificado"). Cor + ícone, nunca só cor (WCAG 1.4.1). */
  success?: string;
  size?: InputSize;
}

// Abaixo de `sm` o texto é 16px: iOS não dá zoom automático ao focar (MOBILE_UX §1.5).
const sizeClasses: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-base sm:text-sm',
  md: 'h-10 px-3 text-base sm:text-sm',
  lg: 'h-12 px-4 text-base',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, success, size = 'md', id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  const hasError = Boolean(error);
  const hasSuccess = !hasError && Boolean(success);
  const message = error ?? success ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="font-body text-sm font-bold text-text-mid">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={message ? descId : undefined}
        className={cn(
          'w-full rounded-sm border bg-surface-2 font-body text-text outline-none',
          'placeholder:text-text-low transition-[color,border-color,box-shadow,background-color] duration-(--dur-base) ease-ds',
          'border-border hover:border-border-2',
          'focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring',
          'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-40',
          hasSuccess && 'border-success/50 hover:border-success/70 focus:border-success',
          hasError && 'border-danger hover:border-danger focus:border-danger [--focus-ring-color:var(--danger)]',
          sizeClasses[size],
          className,
        )}
        {...props}
      />
      {message && (
        <span
          id={descId}
          // Erro de validação é anunciado por leitor de tela assim que aparece
          // (UX §2.7 — feedback de ação). Hint e sucesso permanecem estáticos.
          role={hasError ? 'alert' : undefined}
          aria-live={hasError ? 'assertive' : undefined}
          className={cn(
            'flex items-start gap-1.5 text-sm',
            hasError ? 'text-danger' : hasSuccess ? 'text-success' : 'text-text-low',
          )}
        >
          {hasError && <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          {hasSuccess && <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span>{message}</span>
        </span>
      )}
    </div>
  );
});
