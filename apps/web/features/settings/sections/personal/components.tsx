'use client';

import { cn } from '@/shared/lib/cn';

/** Toggle on/off acessível (DS v2). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-surface-3',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-surface transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/** Linha de configuração: label + descrição à esquerda, controle à direita. */
export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        {description && <p className="text-xs text-text-low">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm text-text-mid">
      {label}
      {children}
    </label>
  );
}

export const selectClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md';
