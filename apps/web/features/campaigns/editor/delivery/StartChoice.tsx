'use client';

/**
 * "Quando começa": **Enviar agora** ou **Agendar** (F58-S10).
 *
 * Agendar mostra dia, hora e o fuso em que esses números valem — e devolve a
 * escolha por extenso ("sex., 9 de out. às 09:00 · Horário de Brasília, GMT-3"),
 * com a conversão para o relógio de quem está agendando quando o fuso da
 * campanha é outro. É aqui que agendamento costuma mentir; aqui não mente.
 */
import type * as React from 'react';
import { useId, useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { ChoiceGroup } from './ChoiceGroup';
import { fieldClass } from './field';
import {
  quickSchedules,
  resolveMoment,
  timezoneGroups,
  todayIn,
  type DeliveryIssue,
  type DeliveryStepValue,
  type StartMode,
} from './model';
import {
  allTimeZones,
  formatClock,
  formatMoment,
  isValidTimeZone,
  offsetLabel,
  timeZoneName,
  type WallTimeResolution,
} from './timezone';

export interface StartChoiceProps {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly issues: readonly DeliveryIssue[];
  readonly showErrors: boolean;
  readonly now: Date;
  readonly browserZone: string;
  readonly disabled: boolean;
}

const START_OPTIONS = [
  {
    id: 'now' as const,
    title: 'Enviar agora',
    description: 'Começa assim que você iniciar a campanha na revisão.',
  },
  {
    id: 'scheduled' as const,
    title: 'Agendar',
    description: 'Escolha o dia e a hora. A campanha começa sozinha.',
  },
];

export function TimezoneField({
  value,
  onChange,
  issue,
  now,
  browserZone,
  disabled,
}: {
  readonly value: string;
  readonly onChange: (timezone: string) => void;
  readonly issue: DeliveryIssue | undefined;
  readonly now: Date;
  readonly browserZone: string;
  readonly disabled: boolean;
}): React.JSX.Element {
  const id = useId();
  const valid = isValidTimeZone(value);
  const groups = useMemo(
    () => timezoneGroups(value, browserZone, allTimeZones()),
    [value, browserZone],
  );
  const knownIds = new Set([...groups.brazil.map((z) => z.id), ...groups.others]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        Fuso horário da campanha
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={issue ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass(issue !== undefined, 'w-full sm:max-w-md')}
      >
        {!knownIds.has(value) ? (
          <option value={value}>{`${value || 'Sem fuso'} (não reconhecido)`}</option>
        ) : null}
        <optgroup label="Brasil">
          {groups.brazil.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label} ({offsetLabel(now, zone.id)})
            </option>
          ))}
        </optgroup>
        <optgroup label="Outros fusos">
          {groups.others.map((zone) => (
            <option key={zone} value={zone} disabled={!isValidTimeZone(zone)}>
              {zone.replace(/_/gu, ' ')}
              {zone === browserZone ? ' — o seu' : ''}
            </option>
          ))}
        </optgroup>
      </select>
      {issue ? (
        <div id={`${id}-hint`} role="alert" className="flex flex-col gap-0.5 text-xs">
          <p className="font-medium text-danger">{issue.text}</p>
          <p className="text-text-low">
            Ele veio de uma configuração antiga. Sem um fuso válido não dá para saber a que horas
            “9h” acontece.
          </p>
        </div>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-text-low">
          {valid ? `${timeZoneName(value, now)} · ` : ''}O início, os horários permitidos e a virada
          do limite diário seguem este fuso.
        </p>
      )}
    </div>
  );
}

export function StartChoice({
  value,
  onChange,
  issues,
  showErrors,
  now,
  browserZone,
  disabled,
}: StartChoiceProps): React.JSX.Element {
  const dateId = useId();
  const timeId = useId();
  const scheduleIssue = issues.find((i) => i.field === 'schedule');
  const tzIssue = issues.find((i) => i.field === 'timezone');
  // "Faltou a data" só depois de tentar avançar; "já passou" aparece na hora.
  const visibleScheduleIssue =
    scheduleIssue && (showErrors || scheduleIssue.code !== 'schedule_missing')
      ? scheduleIssue
      : undefined;
  const tzOk = isValidTimeZone(value.timezone);
  const moment = resolveMoment(value.scheduleDate, value.scheduleTime, value.timezone);
  const quick = quickSchedules(now, value.timezone);
  const minDate = todayIn(now, value.timezone);

  const set = (patch: Partial<DeliveryStepValue>): void => onChange({ ...value, ...patch });

  return (
    <section aria-labelledby={`${dateId}-title`} className="flex flex-col gap-3">
      <h3 id={`${dateId}-title`} className="font-head text-sm font-semibold text-text">
        Quando começa
      </h3>
      <ChoiceGroup<StartMode>
        label="Quando começa"
        options={START_OPTIONS}
        value={value.start}
        disabled={disabled}
        onChange={(start) => set({ start })}
      />

      {value.start === 'scheduled' ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3.5">
          {quick.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Atalhos de data"
            >
              {quick.map((q) => {
                const active = value.scheduleDate === q.date && value.scheduleTime === q.time;
                return (
                  <button
                    key={q.label}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => set({ scheduleDate: q.date, scheduleTime: q.time })}
                    className={cn(
                      'min-h-9 rounded-pill border px-3 text-xs font-medium outline-none',
                      'transition-colors duration-150 motion-reduce:transition-none focus-visible:shadow-glow-md',
                      active
                        ? 'border-text-mid bg-surface-2 text-text'
                        : 'border-border text-text-mid hover:border-border-2 hover:text-text',
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-3 sm:max-w-md">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={dateId} className="text-xs font-medium text-text-mid">
                Dia
              </label>
              <input
                id={dateId}
                type="date"
                value={value.scheduleDate}
                min={minDate || undefined}
                disabled={disabled}
                aria-invalid={visibleScheduleIssue ? true : undefined}
                aria-describedby={`${dateId}-feedback`}
                onChange={(e) => set({ scheduleDate: e.target.value })}
                className={fieldClass(visibleScheduleIssue !== undefined, 'w-full')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={timeId} className="text-xs font-medium text-text-mid">
                Hora
              </label>
              <input
                id={timeId}
                type="time"
                step={60}
                value={value.scheduleTime}
                disabled={disabled}
                aria-invalid={visibleScheduleIssue ? true : undefined}
                aria-describedby={`${dateId}-feedback`}
                onChange={(e) => set({ scheduleTime: e.target.value })}
                className={fieldClass(visibleScheduleIssue !== undefined, 'w-full')}
              />
            </div>
          </div>

          <div id={`${dateId}-feedback`} aria-live="polite" className="text-xs">
            {visibleScheduleIssue ? (
              <p role="alert" className="text-danger">
                {visibleScheduleIssue.text}
              </p>
            ) : moment.kind === 'ok' && tzOk ? (
              <ScheduleConfirmation
                resolution={moment.resolution}
                timezone={value.timezone}
                browserZone={browserZone}
                now={now}
              />
            ) : !tzOk ? (
              <p className="text-text-low">Escolha um fuso válido para conferir o horário.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <TimezoneField
        value={value.timezone}
        onChange={(timezone) => set({ timezone })}
        issue={tzIssue}
        now={now}
        browserZone={browserZone}
        disabled={disabled}
      />
    </section>
  );
}

function ScheduleConfirmation({
  resolution,
  timezone,
  browserZone,
  now,
}: {
  readonly resolution: WallTimeResolution;
  readonly timezone: string;
  readonly browserZone: string;
  readonly now: Date;
}): React.JSX.Element {
  const instant = resolution.instant;
  const sameClock =
    browserZone === timezone ||
    offsetLabel(instant, browserZone) === offsetLabel(instant, timezone);
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-text">
        Começa <span className="font-medium">{formatMoment(instant, timezone, now)}</span>
        <span className="text-text-low">
          {' '}
          · {timeZoneName(timezone, instant)}, {offsetLabel(instant, timezone)}
        </span>
      </p>
      {resolution.kind === 'gap' ? (
        <p className="text-warn">
          Nesse dia o relógio adianta por causa do horário de verão e esse horário não existe. O
          envio começa às {formatClock(instant, timezone)}.
        </p>
      ) : resolution.kind === 'ambiguous' ? (
        <p className="text-warn">
          Nesse dia o relógio volta uma hora e esse horário acontece duas vezes. Vale a primeira.
        </p>
      ) : null}
      {!sameClock ? (
        <p className="text-text-low">
          No seu relógio: {formatMoment(instant, browserZone, now)} (
          {offsetLabel(instant, browserZone)})
        </p>
      ) : null}
    </div>
  );
}
