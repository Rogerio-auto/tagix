'use client';

import type { ReactNode } from 'react';

/** Primitivos de campo do inspector de nodes (F4-S11). DS v2, sem hex. */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-low">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-text-low">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[90px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function DeferredNotice() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      Este node entra em vigor na F5 (Pipeline). A configuracao fica disponivel, mas a acao ainda
      nao executa.
    </div>
  );
}
