'use client';

import { useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { Field, SelectField } from '../inspector-fields';

/** Janela de horario comercial (espelha o schema do condition.handler). */
export interface BusinessHoursValue {
  start?: string;
  end?: string;
  days?: number[];
  timezone?: string;
  timezoneOffsetMinutes?: number;
}

/** Seg-first; `value` segue a convencao do handler (0=Dom … 6=Sab via getUTCDay/Intl). */
const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
] as const;

const WEEKDAY_FULL: Readonly<Record<number, string>> = {
  0: 'Dom',
  1: 'Seg',
  2: 'Ter',
  3: 'Qua',
  4: 'Qui',
  5: 'Sex',
  6: 'Sáb',
};

/** Timezones IANA mais usadas no Brasil + UTC (o handler respeita DST via Intl). */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Manaus (America/Manaus)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (America/Cuiaba)' },
  { value: 'America/Belem', label: 'Belém (America/Belem)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (America/Fortaleza)' },
  { value: 'America/Recife', label: 'Recife (America/Recife)' },
  { value: 'America/Bahia', label: 'Salvador (America/Bahia)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (America/Rio_Branco)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (America/Noronha)' },
  { value: 'UTC', label: 'UTC' },
];

const DEFAULT_TZ = 'America/Sao_Paulo';

function isHHMM(v: string | undefined): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Le com seguranca o objeto `businessHours` (jsonb arbitrario) em um shape conhecido. */
export function readBusinessHours(raw: unknown): BusinessHoursValue {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const days = Array.isArray(r['days'])
    ? r['days'].filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : undefined;
  return {
    start: typeof r['start'] === 'string' ? r['start'] : undefined,
    end: typeof r['end'] === 'string' ? r['end'] : undefined,
    days,
    timezone: typeof r['timezone'] === 'string' ? r['timezone'] : undefined,
    timezoneOffsetMinutes:
      typeof r['timezoneOffsetMinutes'] === 'number' ? r['timezoneOffsetMinutes'] : undefined,
  };
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="time"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:shadow-glow-sm focus:outline-none"
      />
    </Field>
  );
}

export function BusinessHoursField({
  value,
  onChange,
}: {
  value: BusinessHoursValue;
  onChange: (patch: BusinessHoursValue) => void;
}) {
  const days = value.days ?? [];
  const tz = value.timezone ?? DEFAULT_TZ;

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
    onChange({ ...value, days: next });
  };

  // Validacao reativa (estados de erro DS v2).
  const errors = useMemo(() => {
    const list: string[] = [];
    if (!isHHMM(value.start)) list.push('Defina o horario de inicio.');
    if (!isHHMM(value.end)) list.push('Defina o horario de fim.');
    if (days.length === 0) list.push('Selecione ao menos um dia.');
    return list;
  }, [value.start, value.end, days.length]);

  const overnight =
    isHHMM(value.start) && isHHMM(value.end) && value.end <= value.start && value.end !== value.start;

  const preview = useMemo(() => {
    if (errors.length > 0) return null;
    const labelDays = days.map((d) => WEEKDAY_FULL[d]).filter(Boolean).join(', ');
    return `Aberto ${labelDays} · ${value.start}–${value.end}${overnight ? ' (vira o dia)' : ''}`;
  }, [errors.length, days, value.start, value.end, overnight]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-2 bg-surface-1 p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-low">Dias da semana</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const active = days.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleDay(d.value)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus:shadow-glow-sm focus:outline-none',
                  active
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border-2 bg-surface-2 text-text-low hover:text-text',
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TimeInput label="Inicio" value={value.start} onChange={(v) => onChange({ ...value, start: v })} />
        <TimeInput label="Fim" value={value.end} onChange={(v) => onChange({ ...value, end: v })} />
      </div>

      <SelectField
        label="Fuso horario"
        value={tz}
        options={TIMEZONES}
        onChange={(v) => onChange({ ...value, timezone: v })}
        hint="Janela noturna (fim ≤ inicio) cruza a meia-noite automaticamente."
      />

      {preview && (
        <p className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-xs text-text-mid">
          {preview}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
