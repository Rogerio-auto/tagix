'use client';

/**
 * Resumo da etapa Quando enviar (F58-S10): quanto tempo leva, quando começa,
 * quando termina, quanto sai por dia — e por quê.
 *
 * Reage a cada mudança (público, qualidade/capacidade do número, horários,
 * ritmo, limite, prazo) sem ida ao servidor: tudo sai de `forecastDelivery`.
 * Estados obrigatórios (UX §2.6/§2.7/§2.11): skeleton enquanto o público e o
 * número carregam; erro em três partes com nova tentativa; vazio que diz o que
 * falta e leva até lá.
 */
import type * as React from 'react';
import { useId } from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { Button } from '@hm/ui';
import { Skeleton } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import {
  PACE_OPTIONS,
  describeDuration,
  describeHours,
  type DeliveryContext,
  type DeliveryForecast,
  type DeliveryNotice,
  type DeliveryStepValue,
} from './model';
import { UI_LOCALE, formatMoment } from './timezone';

export interface ContextStatus {
  readonly loading: boolean;
  readonly error: string | null;
  readonly retrying: boolean;
  readonly onRetry: (() => void) | null;
}

export interface DeliverySummaryProps {
  readonly value: DeliveryStepValue;
  readonly forecast: DeliveryForecast;
  readonly context: DeliveryContext;
  readonly status: ContextStatus;
  readonly now: Date;
  readonly onEditAudience?: (() => void) | undefined;
  /** Faixa de horário que a lei do mercado impõe no fuso de cada contato (ex.: EUA 8h–21h). */
  readonly contactQuietHours?: { readonly startHour: number; readonly endHour: number } | null;
}

/** Avisos que já aparecem ao lado do campo de agendamento. */
const INLINE_ONLY = new Set<DeliveryNotice['code']>(['schedule_gap', 'schedule_ambiguous']);

function fmt(n: number): string {
  return n.toLocaleString(UI_LOCALE);
}

/** A frase principal do resumo — usada também na faixa compacta do celular. */
export function headline(
  forecast: DeliveryForecast,
  context: DeliveryContext,
  timezone: string,
  now: Date,
): { readonly main: string; readonly sub: string } | null {
  if (context.quality === 'RED') {
    return { main: 'Envio bloqueado', sub: 'A qualidade do número precisa melhorar antes.' };
  }
  const e = forecast.estimate;
  if (context.audience === null || e === null) return null;
  if (e.kind === 'empty') return { main: 'Ninguém para receber', sub: 'O público está vazio.' };
  if (e.kind === 'unfeasible')
    return { main: 'Não termina', sub: 'Mude os horários, o ritmo ou o prazo.' };
  const span = e.finishesAt.getTime() - e.firstSendAt.getTime();
  const main =
    e.sendingDays > 1
      ? `${e.sendingDays} dias de envio`
      : describeDuration(span).replace(/^cerca de /u, '~ ');
  const sub = e.cutByDeadline
    ? `Prazo final para em ${fmt(e.reached)} de ${fmt(context.audience)}`
    : `Termina ${formatMoment(e.finishesAt, timezone, now)}`;
  return { main, sub };
}

function NoticeItem({ notice }: { readonly notice: DeliveryNotice }): React.JSX.Element {
  const Icon =
    notice.tone === 'danger' ? OctagonAlert : notice.tone === 'warn' ? AlertTriangle : Info;
  return (
    <li
      className={cn(
        'flex gap-2.5 rounded-md border px-3 py-2.5',
        notice.tone === 'danger' && 'border-danger/30 bg-danger-bg',
        notice.tone === 'warn' && 'border-warn/30 bg-warn-bg',
        notice.tone === 'info' && 'border-info/30 bg-info-bg',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          notice.tone === 'danger' && 'text-danger',
          notice.tone === 'warn' && 'text-warn',
          notice.tone === 'info' && 'text-info',
        )}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-text">{notice.title}</span>
        <span className="text-xs text-text-mid">{notice.text}</span>
      </span>
    </li>
  );
}

function Row({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
      <dt className="text-xs text-text-low">{term}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

export function DeliverySummary({
  value,
  forecast,
  context,
  status,
  now,
  onEditAudience,
  contactQuietHours = null,
}: DeliverySummaryProps): React.JSX.Element {
  const titleId = useId();
  const audienceUnknown = context.audience === null;
  const e = forecast.estimate;
  const head = headline(forecast, context, value.timezone, now);
  const notices = forecast.notices.filter((n) => !INLINE_ONLY.has(n.code));
  const pace = PACE_OPTIONS.find((p) => p.id === value.pace)?.title ?? 'Personalizado';

  let body: React.ReactNode;
  if (audienceUnknown && status.loading) {
    body = (
      <div aria-busy aria-label="Calculando o envio" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  } else if (audienceUnknown && status.error !== null) {
    body = (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger-bg px-3 py-3"
      >
        <p className="text-sm font-medium text-text">Não conseguimos ler o público e o número</p>
        <p className="text-xs text-text-mid">{status.error}</p>
        <p className="text-xs text-text-low">
          Sem isso, não dá para prever quanto tempo o envio leva. Suas escolhas continuam salvas
          nesta tela.
        </p>
        {status.onRetry ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              loading={status.retrying}
              onClick={status.onRetry}
            >
              Tentar de novo
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else if (audienceUnknown || context.audience === 0) {
    body = (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-4">
        <p className="text-sm font-medium text-text">
          {audienceUnknown
            ? 'Defina o público para ver a previsão'
            : 'Ninguém do público pode receber'}
        </p>
        <p className="text-xs text-text-low">
          {audienceUnknown
            ? 'Com o número de contatos, mostramos quando o envio termina e se ele cabe num dia.'
            : 'Revise o público: contatos sem permissão, inválidos ou descadastrados ficam de fora.'}
        </p>
        {onEditAudience ? (
          <div>
            <Button variant="outline" size="sm" onClick={onEditAudience}>
              Ir para o público
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else {
    body = (
      <>
        <div aria-live="polite" aria-atomic className="flex flex-col gap-0.5">
          <p className="font-head text-2xl font-semibold tracking-tight text-text tabular-nums">
            {head?.main ?? '—'}
          </p>
          {head ? <p className="text-sm text-text-mid">{head.sub}</p> : null}
        </div>

        <dl className="flex flex-col divide-y divide-border">
          <Row term="Começa">
            {value.start === 'now'
              ? 'Ao iniciar a campanha'
              : formatMoment(forecast.startAt, value.timezone, now)}
            {e?.kind === 'ok' &&
            e.firstSendAt.getTime() - forecast.startAt.getTime() > 5 * 60_000 ? (
              <span className="block text-xs text-text-low">
                Primeira mensagem {formatMoment(e.firstSendAt, value.timezone, now)}, quando o
                horário abre
              </span>
            ) : null}
          </Row>
          <Row term={context.mode === 'sequence' ? 'Primeira mensagem para' : 'Para'}>
            {fmt(context.audience ?? 0)} {context.audience === 1 ? 'contato' : 'contatos'}
          </Row>
          <Row term="Horários">{describeHours(value)}</Row>
          <Row term="Por dia">
            {forecast.dailyCap === null
              ? 'Sem limite'
              : `Até ${fmt(forecast.dailyCap)} ${forecast.dailyCapSource === 'provider' ? '— capacidade do número' : '— o seu limite'}`}
          </Row>
          <Row term="Ritmo">
            {pace}
            {forecast.effectiveRate > 0 ? (
              <span className="text-text-low">
                {' '}
                · até {fmt(forecast.effectiveRate * 60)} por hora
                {context.quality === 'YELLOW' ? ' (metade, pelo alerta)' : ''}
              </span>
            ) : null}
          </Row>
        </dl>
      </>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-elev-1"
    >
      <h3 id={titleId} className="text-xs font-medium uppercase tracking-wide text-text-low">
        Resumo do envio
      </h3>
      {body}
      {notices.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Avisos sobre o envio">
          {notices.map((n) => (
            <NoticeItem key={n.code} notice={n} />
          ))}
        </ul>
      ) : null}
      {context.mode === 'sequence' && !audienceUnknown ? (
        <p className="text-xs text-text-low">
          As próximas mensagens da sequência saem conforme as esperas definidas, dentro destes
          horários, e dividem o mesmo ritmo e limite diário.
        </p>
      ) : null}
      {contactQuietHours ? (
        <p className="text-xs text-text-low">
          Pela regra do mercado, cada contato só recebe entre {contactQuietHours.startHour}h e{' '}
          {contactQuietHours.endHour}h no fuso dele. Quem estiver fora disso recebe quando o horário
          dele abrir — o que pode alongar o envio.
        </p>
      ) : null}
    </section>
  );
}

/** Faixa compacta para o topo da etapa no celular: a resposta antes da pergunta. */
export function DeliverySummaryStrip({
  forecast,
  context,
  timezone,
  now,
}: {
  readonly forecast: DeliveryForecast;
  readonly context: DeliveryContext;
  readonly timezone: string;
  readonly now: Date;
}): React.JSX.Element | null {
  const head = headline(forecast, context, timezone, now);
  if (!head) return null;
  const worst =
    forecast.notices.find((n) => n.tone === 'danger') ??
    forecast.notices.find((n) => n.tone === 'warn');
  return (
    <div
      aria-hidden
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 md:hidden"
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-head text-base font-semibold text-text tabular-nums">
          {head.main}
        </span>
        <span className="truncate text-xs text-text-mid">{head.sub}</span>
      </span>
      {worst ? (
        <AlertTriangle
          className={cn('size-4 shrink-0', worst.tone === 'danger' ? 'text-danger' : 'text-warn')}
        />
      ) : null}
    </div>
  );
}
