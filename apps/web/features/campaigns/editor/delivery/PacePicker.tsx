'use client';

/**
 * "Em que ritmo" (F58-S10).
 *
 * Três ritmos com nome e efeito — "termina hoje às 10:40" — em vez de um campo
 * "mensagens por minuto". A unidade técnica só aparece em Configurações
 * avançadas (CAMPAIGNS.md §2: "preferir opções recomendadas").
 */
import type * as React from 'react';
import { useId } from 'react';
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup';
import {
  PACE_OPTIONS,
  forecastDelivery,
  type DeliveryContext,
  type DeliveryForecast,
  type DeliveryStepValue,
  type PaceId,
} from './model';
import { UI_LOCALE, formatMoment } from './timezone';

export interface PacePickerProps {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly context: DeliveryContext;
  readonly now: Date;
  readonly disabled: boolean;
}

/** Efeito de um ritmo para este público, numa linha. */
export function paceEffect(
  forecast: DeliveryForecast,
  timezone: string,
  now: Date,
  audienceKnown: boolean,
): string {
  const perHour = (forecast.effectiveRate * 60).toLocaleString(UI_LOCALE);
  if (!audienceKnown || forecast.estimate === null) return `Até ${perHour} mensagens por hora`;
  const e = forecast.estimate;
  if (e.kind === 'empty') return `Até ${perHour} mensagens por hora`;
  if (e.kind === 'unfeasible') return 'Não termina com os horários atuais';
  const when = formatMoment(e.finishesAt, timezone, now);
  const days = e.sendingDays > 1 ? ` · ${e.sendingDays} dias` : '';
  return e.cutByDeadline ? `Não termina antes do prazo` : `Termina ${when}${days}`;
}

export function PacePicker({
  value,
  onChange,
  context,
  now,
  disabled,
}: PacePickerProps): React.JSX.Element {
  const titleId = useId();
  const audienceKnown = context.audience !== null;

  const options: ChoiceOption<PaceId>[] = PACE_OPTIONS.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.hint,
    meta: paceEffect(
      forecastDelivery(value, context, now, p.ratePerMinute),
      value.timezone,
      now,
      audienceKnown,
    ),
  }));
  if (value.pace === 'custom') {
    options.push({
      id: 'custom',
      title: 'Personalizado',
      description: 'Definido em configurações avançadas.',
      meta: paceEffect(forecastDelivery(value, context, now), value.timezone, now, audienceKnown),
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="font-head text-sm font-semibold text-text">
          Em que ritmo
        </h3>
        <p className="text-xs text-text-low">
          Enviar devagar protege a reputação do número no WhatsApp. O previsto já considera o seu
          público e os horários escolhidos.
        </p>
      </div>
      <ChoiceGroup<PaceId>
        label="Ritmo do envio"
        options={options}
        value={value.pace}
        disabled={disabled}
        columns={options.length === 4 ? 'four' : 'three'}
        onChange={(pace) => {
          const preset = PACE_OPTIONS.find((p) => p.id === pace);
          onChange({
            ...value,
            pace,
            customRate: preset ? preset.ratePerMinute : value.customRate,
          });
        }}
      />
    </section>
  );
}
