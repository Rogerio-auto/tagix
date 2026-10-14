'use client';

/**
 * Configurações avançadas da etapa Quando enviar (F58-S10).
 *
 * Os números técnicos moram aqui — ritmo exato, limite por dia, prazo final —
 * e cada um mostra o EFEITO ao lado ("o envio passa a levar 3 dias"), nunca o
 * número sozinho. O cabeçalho fechado resume o que está valendo, para que nada
 * fique escondido atrás do clique (UX §2.4).
 */
import type * as React from 'react';
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { fieldClass } from './field';
import {
  DAILY_LIMIT_MAX,
  RATE_AGGRESSIVE_ABOVE,
  RATE_MAX,
  RATE_MIN,
  describeDuration,
  paceForRate,
  rateForPace,
  todayIn,
  type DeliveryContext,
  type DeliveryForecast,
  type DeliveryIssue,
  type DeliveryStepValue,
} from './model';
import { UI_LOCALE, formatMoment } from './timezone';

export interface AdvancedSettingsProps {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly forecast: DeliveryForecast;
  readonly context: DeliveryContext;
  readonly issues: readonly DeliveryIssue[];
  readonly showErrors: boolean;
  readonly now: Date;
  readonly disabled: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString(UI_LOCALE);
}

/** Resumo do cabeçalho fechado: o que está valendo hoje. */
export function advancedSummary(value: DeliveryStepValue): string {
  const parts = [
    `${fmt(rateForPace(value) || 0)} por minuto`,
    value.dailyLimitEnabled ? `até ${fmt(value.dailyLimit)} por dia` : 'sem limite por dia',
    value.deadlineEnabled && value.deadlineDate
      ? `prazo ${value.deadlineDate.split('-').reverse().slice(0, 2).join('/')} ${value.deadlineTime}`
      : 'sem prazo final',
  ];
  return parts.join(' · ');
}

export function AdvancedSettings({
  value,
  onChange,
  forecast,
  context,
  issues,
  showErrors,
  now,
  disabled,
}: AdvancedSettingsProps): React.JSX.Element {
  const id = useId();
  const startsOpen =
    value.pace === 'custom' ||
    value.dailyLimitEnabled ||
    value.deadlineEnabled ||
    issues.length > 0;
  const [open, setOpen] = useState(startsOpen);
  // Pendência aqui dentro não pode ficar escondida depois de tentar avançar.
  const expanded = open || (showErrors && issues.length > 0);

  const set = (patch: Partial<DeliveryStepValue>): void => onChange({ ...value, ...patch });
  const issueOf = (field: DeliveryIssue['field']): DeliveryIssue | undefined =>
    issues.find((i) => i.field === field);
  const rateIssue = issueOf('pace');
  const dailyIssue = issueOf('dailyLimit');
  const deadlineIssue = issueOf('deadline');
  // "Faltou a data" só depois de tentar avançar; o resto aparece na hora.
  const visibleDeadlineIssue =
    deadlineIssue && (showErrors || deadlineIssue.code !== 'deadline_missing')
      ? deadlineIssue
      : undefined;

  const rate = rateForPace(value);
  const estimate = forecast.estimate;
  const audience = context.audience;

  return (
    <section className="rounded-md border border-border bg-surface">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3.5 py-3 text-left outline-none',
          'transition-colors duration-150 motion-reduce:transition-none hover:bg-surface-2 focus-visible:shadow-glow-md',
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-text">Configurações avançadas</span>
          <span className="truncate text-xs text-text-low">{advancedSummary(value)}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-text-low transition-transform duration-150 motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded ? (
        <div id={`${id}-panel`} className="flex flex-col gap-5 border-t border-border px-3.5 py-4">
          {/* Ritmo exato */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-rate`} className="text-sm font-medium text-text">
              Ritmo exato
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`${id}-rate`}
                type="number"
                inputMode="numeric"
                min={RATE_MIN}
                max={RATE_MAX}
                step={1}
                value={Number.isFinite(rate) && rate > 0 ? String(rate) : ''}
                disabled={disabled}
                aria-invalid={rateIssue ? true : undefined}
                aria-describedby={`${id}-rate-effect`}
                onChange={(e) => set(paceForRate(Math.floor(Number(e.target.value))))}
                className={fieldClass(rateIssue !== undefined, 'w-24')}
              />
              <span className="text-sm text-text-mid">mensagens por minuto</span>
            </div>
            <p id={`${id}-rate-effect`} className="text-xs" aria-live="polite">
              {rateIssue ? (
                <span role="alert" className="text-danger">
                  {rateIssue.text}
                </span>
              ) : (
                <span className={rate > RATE_AGGRESSIVE_ABOVE ? 'text-warn' : 'text-text-low'}>
                  {`Até ${fmt(forecast.effectiveRate * 60)} por hora`}
                  {estimate?.kind === 'ok' && !estimate.cutByDeadline
                    ? estimate.sendingDays > 1
                      ? ` · este público em ${estimate.sendingDays} dias de envio`
                      : ` · este público em ${describeDuration(estimate.finishesAt.getTime() - estimate.firstSendAt.getTime())}`
                    : ''}
                  {rate > RATE_AGGRESSIVE_ABOVE
                    ? ' · acima de 60, o WhatsApp tende a derrubar a qualidade do número'
                    : ''}
                </span>
              )}
            </p>
          </div>

          {/* Limite por dia */}
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-text sm:min-h-0">
              <input
                type="checkbox"
                checked={value.dailyLimitEnabled}
                disabled={disabled}
                onChange={(e) => set({ dailyLimitEnabled: e.target.checked })}
                className="size-4 accent-current"
              />
              Limitar quantas mensagens saem por dia
            </label>
            {value.dailyLimitEnabled ? (
              <div className="flex items-center gap-2 pl-6.5">
                <span className="text-sm text-text-mid">Até</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={DAILY_LIMIT_MAX}
                  step={1}
                  value={
                    Number.isFinite(value.dailyLimit) && value.dailyLimit > 0
                      ? String(value.dailyLimit)
                      : ''
                  }
                  disabled={disabled}
                  aria-label="Máximo de mensagens por dia"
                  aria-invalid={dailyIssue ? true : undefined}
                  aria-describedby={`${id}-daily-effect`}
                  onChange={(e) => set({ dailyLimit: Math.floor(Number(e.target.value)) })}
                  className={fieldClass(dailyIssue !== undefined, 'w-32')}
                />
                <span className="text-sm text-text-mid">por dia</span>
              </div>
            ) : null}
            <p id={`${id}-daily-effect`} className="pl-6.5 text-xs" aria-live="polite">
              {dailyIssue ? (
                <span role="alert" className="text-danger">
                  {dailyIssue.text}
                </span>
              ) : (
                <DailyEffect
                  forecast={forecast}
                  audience={audience}
                  context={context}
                  enabled={value.dailyLimitEnabled}
                />
              )}
            </p>
          </div>

          {/* Prazo final */}
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-text sm:min-h-0">
              <input
                type="checkbox"
                checked={value.deadlineEnabled}
                disabled={disabled}
                onChange={(e) => set({ deadlineEnabled: e.target.checked })}
                className="size-4 accent-current"
              />
              Parar de enviar numa data
            </label>
            {value.deadlineEnabled ? (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-3 pl-6.5 sm:max-w-md">
                <input
                  type="date"
                  value={value.deadlineDate}
                  min={todayIn(now, value.timezone) || undefined}
                  disabled={disabled}
                  aria-label="Dia do prazo final"
                  aria-invalid={visibleDeadlineIssue ? true : undefined}
                  aria-describedby={`${id}-deadline-effect`}
                  onChange={(e) => set({ deadlineDate: e.target.value })}
                  className={fieldClass(visibleDeadlineIssue !== undefined, 'w-full')}
                />
                <input
                  type="time"
                  step={60}
                  value={value.deadlineTime}
                  disabled={disabled}
                  aria-label="Hora do prazo final"
                  aria-invalid={visibleDeadlineIssue ? true : undefined}
                  aria-describedby={`${id}-deadline-effect`}
                  onChange={(e) => set({ deadlineTime: e.target.value })}
                  className={fieldClass(visibleDeadlineIssue !== undefined, 'w-full')}
                />
              </div>
            ) : null}
            <p id={`${id}-deadline-effect`} className="pl-6.5 text-xs" aria-live="polite">
              {visibleDeadlineIssue ? (
                <span role="alert" className="text-danger">
                  {visibleDeadlineIssue.text}
                </span>
              ) : value.deadlineEnabled && forecast.deadline ? (
                <span className="text-text-low">
                  Nada sai a partir de {formatMoment(forecast.deadline, value.timezone, now)}. Quem
                  não tiver recebido até lá fica de fora.
                  {estimate?.kind === 'ok' && estimate.cutByDeadline && audience !== null ? (
                    <span className="text-danger">
                      {' '}
                      Com as escolhas atuais, {fmt(audience - estimate.reached)} de {fmt(audience)}{' '}
                      ficariam sem receber.
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-text-low">
                  Útil para promoção com data para acabar. Sem prazo, o envio segue até chegar a
                  todos.
                </span>
              )}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DailyEffect({
  forecast,
  audience,
  context,
  enabled,
}: {
  readonly forecast: DeliveryForecast;
  readonly audience: number | null;
  readonly context: DeliveryContext;
  readonly enabled: boolean;
}): React.JSX.Element {
  const provider = context.providerDailyLimit;
  const providerText =
    provider !== null ? `O número alcança até ${fmt(provider)} pessoas por dia no WhatsApp. ` : '';
  const e = forecast.estimate;
  if (!enabled) {
    return (
      <span className="text-text-low">
        {providerText}Sem limite próprio, o envio segue o ritmo e os horários escolhidos.
      </span>
    );
  }
  if (forecast.dailyCapSource === 'provider') {
    return (
      <span className="text-warn">
        {providerText}O seu limite é maior que isso, então vale o do número.
      </span>
    );
  }
  if (audience === null || e === null || e.kind !== 'ok') {
    return (
      <span className="text-text-low">{providerText}O que não couber num dia sai no seguinte.</span>
    );
  }
  return e.sendingDays > 1 ? (
    <span className="text-warn">
      Com {fmt(audience)} contatos, o envio se divide em {e.sendingDays} dias.
    </span>
  ) : (
    <span className="text-text-low">
      {providerText}Os {fmt(audience)} contatos cabem num dia.
    </span>
  );
}
