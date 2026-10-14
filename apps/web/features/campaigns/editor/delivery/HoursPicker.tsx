'use client';

/**
 * "Em que horários pode chegar" (F58-S10).
 *
 * Presets legíveis primeiro — quase todo mundo quer "horário comercial". Quem
 * precisa de mais abre o editor semanal: um dia por linha, faixas com hora de
 * início e fim, copiar para os outros dias. Sem a palavra "janela": a pergunta é
 * a que a pessoa faz ("a que horas a mensagem pode chegar?").
 *
 * Teclado: o grupo de presets anda com setas; no editor, tudo é campo nativo
 * (Tab/Shift+Tab, setas no relógio), com rótulo que diz o dia e a faixa.
 */
import type * as React from 'react';
import { useId, useState } from 'react';
import { CopyPlus, Plus, X } from 'lucide-react';
import { IconButton } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup';
import { fieldClass } from './field';
import {
  HOURS_PRESETS,
  MAX_WINDOWS_PER_DAY,
  WEEKDAYS,
  addWindow,
  applyHoursPreset,
  copyDayToActiveDays,
  describeHours,
  detectHoursPreset,
  removeWindow,
  startCustomHours,
  toggleDay,
  updateWindow,
  windowsForDay,
  type DeliveryIssue,
  type DeliveryStepValue,
  type HoursPresetId,
} from './model';

export interface HoursPickerProps {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly issues: readonly DeliveryIssue[];
  readonly disabled: boolean;
}

const OPTIONS: readonly ChoiceOption<HoursPresetId>[] = [
  ...HOURS_PRESETS.map((p) => ({ id: p.id, title: p.title, description: p.detail })),
  { id: 'custom', title: 'Personalizar', description: 'Escolha dia a dia' },
];

export function HoursPicker({
  value,
  onChange,
  issues,
  disabled,
}: HoursPickerProps): React.JSX.Element {
  const titleId = useId();
  const detected = detectHoursPreset(value);
  // Abrir o editor não muda a grade: sem este estado, "Personalizar" voltaria
  // a marcar o preset que a grade ainda iguala.
  const [editing, setEditing] = useState(detected === 'custom');
  const selected: HoursPresetId = editing ? 'custom' : detected;
  const hoursIssues = issues.filter((i) => i.field === 'hours');
  const general = hoursIssues.find((i) => i.windowKey === undefined);

  function choose(id: HoursPresetId): void {
    if (id === 'custom') {
      setEditing(true);
      onChange(startCustomHours(value));
      return;
    }
    setEditing(false);
    onChange(applyHoursPreset(value, id));
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="font-head text-sm font-semibold text-text">
          Em que horários a mensagem pode chegar
        </h3>
        <p className="text-xs text-text-low">
          Fora deles, o envio pausa sozinho e continua quando o próximo horário abrir.
        </p>
      </div>

      <ChoiceGroup<HoursPresetId>
        label="Horários permitidos"
        options={OPTIONS}
        value={selected}
        onChange={choose}
        disabled={disabled}
        columns="three"
      />

      {selected === 'custom' ? (
        <WeeklyEditor value={value} onChange={onChange} issues={hoursIssues} disabled={disabled} />
      ) : null}

      {general ? (
        <p role="alert" className="text-xs text-danger">
          {general.text}
        </p>
      ) : value.hoursEnabled && selected === 'custom' ? (
        <p className="text-xs text-text-mid" aria-live="polite">
          {describeHours(value)}
        </p>
      ) : null}
    </section>
  );
}

function WeeklyEditor({
  value,
  onChange,
  issues,
  disabled,
}: {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly issues: readonly DeliveryIssue[];
  readonly disabled: boolean;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Horários por dia da semana"
      className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface"
    >
      {WEEKDAYS.map(({ day, long }) => {
        const slots = value.hoursEnabled ? windowsForDay(value, day) : [];
        const on = slots.length > 0;
        const checkboxId = `delivery-day-${day}`;
        return (
          <div
            key={day}
            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4"
          >
            <label
              htmlFor={checkboxId}
              className="flex min-h-11 w-28 shrink-0 cursor-pointer items-center gap-2.5 text-sm text-text sm:min-h-10"
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={(e) => onChange(toggleDay(value, day, e.target.checked))}
                className="size-4 accent-current"
              />
              {long}
            </label>

            {on ? (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {slots.map((slot, index) => {
                  const issue = issues.find((i) => i.windowKey === slot.key);
                  const label = `${long}, faixa ${index + 1}`;
                  return (
                    <div key={slot.key} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="time"
                          step={300}
                          value={slot.start}
                          disabled={disabled}
                          aria-label={`${label}: começa às`}
                          aria-invalid={issue ? true : undefined}
                          onChange={(e) =>
                            onChange(updateWindow(value, slot.key, { start: e.target.value }))
                          }
                          className={fieldClass(issue !== undefined, 'w-32')}
                        />
                        <span className="text-xs text-text-low">até</span>
                        <input
                          type="time"
                          step={300}
                          value={slot.end}
                          disabled={disabled}
                          aria-label={`${label}: termina às`}
                          aria-invalid={issue ? true : undefined}
                          onChange={(e) =>
                            onChange(updateWindow(value, slot.key, { end: e.target.value }))
                          }
                          className={fieldClass(issue !== undefined, 'w-32')}
                        />
                        <IconButton
                          size="sm"
                          aria-label={`Remover ${label.toLowerCase()}`}
                          icon={<X aria-hidden />}
                          disabled={disabled}
                          onClick={() => onChange(removeWindow(value, slot.key))}
                          className="touch-target"
                        />
                      </div>
                      {issue ? (
                        <p role="alert" className="text-xs text-danger">
                          {issue.text}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <button
                    type="button"
                    disabled={disabled || slots.length >= MAX_WINDOWS_PER_DAY}
                    onClick={() => onChange(addWindow(value, day))}
                    className={linkButton}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Outra faixa
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(copyDayToActiveDays(value, day))}
                    className={linkButton}
                  >
                    <CopyPlus className="size-3.5" aria-hidden />
                    Usar este horário nos outros dias marcados
                  </button>
                </div>
              </div>
            ) : (
              <p className="flex min-h-10 items-center text-xs text-text-low">Não envia</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const linkButton = cn(
  'inline-flex min-h-9 items-center gap-1.5 rounded-xs text-xs font-medium text-text-mid outline-none',
  'transition-colors duration-150 motion-reduce:transition-none hover:text-text focus-visible:shadow-glow-md',
  'disabled:cursor-not-allowed disabled:opacity-40',
);
