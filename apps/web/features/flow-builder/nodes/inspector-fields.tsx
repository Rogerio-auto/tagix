'use client';

import type { ReactNode } from 'react';

/**
 * Primitivos de campo do inspector de nodes (F4-S11). Mesmo desenho do `Input` do DS
 * (14px no desktop; 16px abaixo de `sm`, que evita o zoom do iOS ao focar). Sem hex.
 */

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
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  /** Valor técnico (caminho de variável, URL): em mono, como no canvas. */
  mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={mono ? false : undefined}
        autoCapitalize={mono ? 'off' : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${mono ? 'font-mono' : 'font-body'} rounded-sm border border-border bg-surface-2 px-3 py-2 text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring sm:text-sm`}
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
        className="min-h-[90px] rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring sm:text-sm"
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  hint,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  /** Limite inferior nativo do input (opcional, retrocompatível). */
  min?: number;
  /** Limite superior nativo do input (opcional, retrocompatível). */
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring sm:text-sm"
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
        className="rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring sm:text-sm"
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
    <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
      Este node entra em vigor na F5 (Pipeline). A configuração fica disponível, mas a ação ainda
      não executa.
    </div>
  );
}
