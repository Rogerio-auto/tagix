'use client';

import { cn } from '@/shared/lib/cn';

/** Switch acessível (checkbox nativo estilizado, DS v2). Reusado em modelos/políticas. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill outline-none transition-colors',
        'focus-visible:shadow-glow-md disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-surface-3',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-pill bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
        aria-hidden
      />
    </button>
  );
}
