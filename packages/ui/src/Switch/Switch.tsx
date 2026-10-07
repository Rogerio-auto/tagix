import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useCallback, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> {
  /** Controlado. Sem ele o Switch guarda o próprio estado (começa em `defaultChecked`). */
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Rótulo visível (clicável). Sem ele, passe `aria-label`. */
  label?: ReactNode;
  /** Texto de apoio sob o rótulo. */
  description?: ReactNode;
  /** Ação assíncrona em curso: mostra spinner no polegar e bloqueia (UX §2.7). */
  loading?: boolean;
}

/**
 * Switch (role="switch") do DS 3.0. State morph: o polegar viaja com a curva spring
 * e muda de cor; sob `prefers-reduced-motion` troca sem deslocamento animado.
 * Teclado: Espaço/Enter alternam (comportamento nativo do <button>).
 * Alvo de toque ≥44px por pseudo-elemento invisível (WCAG 2.5.8).
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    defaultChecked = false,
    onCheckedChange,
    label,
    description,
    loading = false,
    disabled,
    className,
    id,
    onClick,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;
  const [inner, setInner] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const on = isControlled ? checked : inner;

  const toggle = useCallback(() => {
    const next = !on;
    if (!isControlled) setInner(next);
    onCheckedChange?.(next);
  }, [on, isControlled, onCheckedChange]);

  const control = (
    <button
      {...props}
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={on}
      aria-busy={loading || undefined}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descId : undefined}
      disabled={disabled || loading}
      data-state={on ? 'checked' : 'unchecked'}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) toggle();
      }}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill border p-[3px] outline-none before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        'transition-[background-color,border-color,box-shadow] duration-(--dur-base) ease-ds',
        'focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:not-aria-busy:opacity-40 aria-busy:cursor-progress',
        on ? 'border-brand-text/40 bg-brand-text/15' : 'border-border-2 bg-surface-3',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 items-center justify-center rounded-pill',
          'motion-safe:transition-[transform,background-color,box-shadow] motion-safe:duration-(--dur-slow) motion-safe:ease-ds-spring',
          on ? 'translate-x-4 bg-brand-text shadow-glow-sm' : 'translate-x-0 bg-text-low',
        )}
      >
        {loading && <Loader2 className="size-3 animate-spin text-bg motion-reduce:animate-none" />}
      </span>
    </button>
  );

  if (!label) return control;

  return (
    <div className="flex items-start gap-3">
      {control}
      <div className="flex min-w-0 flex-col gap-0.5">
        <label id={labelId} htmlFor={switchId} className="cursor-pointer font-body text-sm font-bold text-text">
          {label}
        </label>
        {description && (
          <span id={descId} className="font-body text-sm text-text-low">
            {description}
          </span>
        )}
      </div>
    </div>
  );
});
