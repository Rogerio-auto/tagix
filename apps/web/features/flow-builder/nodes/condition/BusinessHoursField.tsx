'use client';

import { useId, useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { Field } from '../inspector-fields';
import { effectiveTimeZone, timeZoneOptions } from './timezone';

/** Janela de horário comercial (espelha o schema do condition.handler). */
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

const FIELD_CLASS =
  'h-10 rounded-sm border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors hover:border-border-2 focus:border-brand-text focus:shadow-glow-sm focus-visible:focus-ring';

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
        className={cn(FIELD_CLASS, 'font-mono tabular-nums')}
      />
    </Field>
  );
}

/**
 * Janela de horário comercial do nó `condition` (DS 3.0, F72-S07).
 *
 * Fuso sem literal (regra F59-S08): o efetivo é o salvo no nó ou, sem ele, o do navegador
 * com o padrão do market pack como reserva (`./timezone`). Toda edição grava o fuso
 * efetivo junto: o motor avalia em UTC quando o nó não tem fuso, então "mostrar um fuso e
 * salvar outro" não pode acontecer.
 */
export function BusinessHoursField({
  value,
  onChange,
}: {
  value: BusinessHoursValue;
  onChange: (patch: BusinessHoursValue) => void;
}) {
  const days = value.days ?? [];
  const tz = effectiveTimeZone(value.timezone);
  const tzId = useId();
  const options = useMemo(() => timeZoneOptions(tz), [tz]);

  /** Aplica a mudança gravando o fuso efetivo (o que a tela mostra é o que o motor usa). */
  const emit = (patch: BusinessHoursValue): void => onChange({ ...value, timezone: tz, ...patch });

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
    emit({ days: next });
  };

  // Validacao reativa (estados de erro DS v2).
  const errors = useMemo(() => {
    const list: string[] = [];
    if (!isHHMM(value.start)) list.push('Defina o horário de início.');
    if (!isHHMM(value.end)) list.push('Defina o horário de fim.');
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
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-low">Dias da semana</span>
        <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const active = days.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleDay(d.value)}
                className={cn(
                  'h-8 rounded-sm border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:focus-ring',
                  active
                    ? 'border-brand-text/30 bg-brand-text/10 text-brand-text'
                    : 'border-border bg-surface-2 text-text-mid hover:border-border-2 hover:text-text',
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TimeInput label="Início" value={value.start} onChange={(v) => emit({ start: v })} />
        <TimeInput label="Fim" value={value.end} onChange={(v) => emit({ end: v })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={tzId} className="text-xs font-medium text-text-low">
          Fuso horário
        </label>
        <select id={tzId} value={tz} onChange={(e) => emit({ timezone: e.target.value })} className={FIELD_CLASS}>
          <optgroup label="Sugeridos">
            {options.suggested.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Todos os fusos">
            {options.all.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="text-[11px] text-text-low">
          Janela noturna (fim ≤ início) cruza a meia-noite automaticamente.
        </span>
      </div>

      {preview && (
        <p className="rounded-sm border border-border bg-surface-2 px-3 py-2 font-mono text-xs tabular-nums text-text-mid">
          {preview}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="rounded-sm border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
