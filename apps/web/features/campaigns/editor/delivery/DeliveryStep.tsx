'use client';

/**
 * Etapa **Quando enviar** do criador de campanha (F58-S10).
 *
 * Três perguntas em linguagem de gente, nesta ordem:
 *
 * 1. **Quando começa** — Enviar agora ou Agendar (dia, hora e o fuso em que
 *    esses números valem, com o horário de verão resolvido).
 * 2. **Em que horários pode chegar** — presets legíveis; editor semanal para
 *    quem precisa.
 * 3. **Em que ritmo** — Cuidadoso / Recomendado / Rápido, cada um com o efeito
 *    ("termina hoje às 10:40"), não com "mensagens por minuto".
 *
 * Ritmo exato, limite por dia e prazo final ficam em Configurações avançadas,
 * sempre com o efeito ao lado. Ao lado de tudo, o resumo responde "quanto tempo
 * leva e por quê" a cada mudança — inclusive do público e da saúde do número.
 *
 * Contrato com o assistente (igual à etapa Mensagem, F58-S09): componente
 * controlado `value`/`onChange`; publica `onReadinessChange` com o payload do
 * `PATCH /api/campaigns/:id` pronto. A etapa não salva sozinha — o orquestrador
 * (F58-S13) decide quando.
 *
 * UX_PRINCIPLES aplicados: §2.1 (o cartão inteiro é a escolha), §2.4 (o
 * avançado fechado mostra o que está valendo), §2.5 (HelpPanel `?`), §2.6
 * (resumo sem público leva ao público), §2.7 (skeleton no resumo, botão com
 * loading ao tentar de novo, efeito imediato a cada mudança), §2.10 (setas nos
 * grupos de opção, campos nativos de data/hora), §2.11 (erro em três partes),
 * §3.6 (skeleton no lugar do conteúdo), §8 (alvos de 44 px, campos de 16 px no
 * celular, resumo compacto no topo em telas pequenas).
 */
import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HelpPanel } from '@/shared/components/help';
import { AdvancedSettings } from './AdvancedSettings';
import { DeliveryHelp } from './DeliveryHelp';
import { DeliverySummary, DeliverySummaryStrip } from './DeliverySummary';
import { HoursPicker } from './HoursPicker';
import {
  forecastDelivery,
  toDeliveryPayload,
  validateDelivery,
  type CampaignMode,
  type ChannelQuality,
  type DeliveryContext,
  type DeliveryForecast,
  type DeliveryIssue,
  type DeliveryNotice,
  type DeliveryPayload,
  type DeliveryStepValue,
} from './model';
import { PacePicker } from './PacePicker';
import { useDeliveryContext } from './queries';
import { StartChoice } from './StartChoice';
import { browserTimeZone } from './timezone';

export interface DeliveryStepReadiness {
  /** `true` sem pendências, com fuso válido e uma configuração que termina. */
  readonly canAdvance: boolean;
  readonly issues: readonly DeliveryIssue[];
  /** Avisos que não bloqueiam a etapa (a Revisão decide o que bloqueia o início). */
  readonly notices: readonly DeliveryNotice[];
  /** Campos do `PATCH /api/campaigns/:id` — `null` enquanto houver pendência. */
  readonly payload: DeliveryPayload | null;
}

export interface DeliveryStepProps {
  readonly value: DeliveryStepValue;
  readonly onChange: (next: DeliveryStepValue) => void;
  readonly mode: CampaignMode;
  /** Rascunho salvo: dele vêm o público elegível e a saúde do número. */
  readonly campaignId: string | null;
  /** Público ainda não salvo (sobrepõe o do servidor). */
  readonly audienceSize?: number | null;
  /** Saúde do número já conhecida pelo assistente (sobrepõe a consulta). */
  readonly channelHealth?: {
    readonly quality: ChannelQuality;
    readonly providerDailyLimit: number | null;
  } | null;
  /** Regra de horário por contato do mercado (ex.: EUA 8h–21h). `null` = não há. */
  readonly contactQuietHours?: { readonly startHour: number; readonly endHour: number } | null;
  readonly readOnly?: boolean;
  /** Mostra todos os erros (o orquestrador liga depois de tentar avançar). */
  readonly showAllErrors?: boolean;
  readonly onEditAudience?: () => void;
  readonly onReadinessChange?: (readiness: DeliveryStepReadiness) => void;
  /** Relógio fixo (testes). Sem ele, a etapa reavalia "já passou" a cada 30 s. */
  readonly now?: Date;
}

const CLOCK_TICK_MS = 30_000;

function useClock(fixed: Date | undefined): Date {
  const [now, setNow] = useState<Date>(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) return;
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

export function DeliveryStep({
  value,
  onChange,
  mode,
  campaignId,
  audienceSize,
  channelHealth,
  contactQuietHours = null,
  readOnly = false,
  showAllErrors = false,
  onEditAudience,
  onReadinessChange,
  now: fixedNow,
}: DeliveryStepProps): React.JSX.Element {
  const now = useClock(fixedNow);
  // O fuso do navegador só existe no cliente: lido depois de montar, para o
  // HTML do servidor e o do cliente baterem.
  const [browserZone, setBrowserZone] = useState(value.timezone);
  useEffect(() => setBrowserZone(browserTimeZone(value.timezone)), [value.timezone]);

  const remote = useDeliveryContext(campaignId);
  const context: DeliveryContext = {
    audience: audienceSize ?? remote.data?.eligible ?? null,
    quality: channelHealth?.quality ?? remote.data?.quality ?? 'UNKNOWN',
    providerDailyLimit:
      channelHealth !== undefined && channelHealth !== null
        ? channelHealth.providerDailyLimit
        : (remote.data?.providerDailyLimit ?? null),
    mode,
  };

  const issues = useMemo(() => validateDelivery(value, now), [value, now]);
  const forecast: DeliveryForecast = useMemo(
    () => forecastDelivery(value, context, now),
    // `context` é recriado a cada render; as partes dele são as dependências reais.
    [value, now, context.audience, context.quality, context.providerDailyLimit, context.mode],
  );

  const unfeasible = forecast.notices.some((n) => n.code === 'unfeasible');
  const canAdvance = !readOnly && issues.length === 0 && !unfeasible;
  const payloadKey = canAdvance ? JSON.stringify(toDeliveryPayload(value, now)) : null;
  const issuesKey = JSON.stringify(issues.map((i) => [i.code, i.windowKey]));
  const noticesKey = JSON.stringify(forecast.notices.map((n) => [n.code, n.text]));

  // Publica só quando muda de fato — o orquestrador não pode entrar em laço.
  const publishRef = useRef(onReadinessChange);
  publishRef.current = onReadinessChange;
  const latest = useRef({ issues, notices: forecast.notices });
  latest.current = { issues, notices: forecast.notices };
  useEffect(() => {
    const payload = payloadKey === null ? null : (JSON.parse(payloadKey) as DeliveryPayload | null);
    publishRef.current?.({
      canAdvance: payload !== null,
      issues: latest.current.issues,
      notices: latest.current.notices,
      payload,
    });
  }, [payloadKey, issuesKey, noticesKey]);

  const status = {
    loading: campaignId !== null && audienceSize == null && remote.isPending,
    error: remote.isError ? remote.error.message : null,
    retrying: remote.isFetching,
    onRetry: campaignId !== null ? () => void remote.refetch() : null,
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-head text-base font-semibold text-text">Quando enviar</h2>
          <p className="text-sm text-text-mid">
            Escolha quando começa, em que horários a mensagem pode chegar e em que ritmo. O resumo
            mostra quanto tempo leva antes de você continuar.
          </p>
        </div>
        <HelpPanel title="Como funciona o envio">
          <DeliveryHelp />
        </HelpPanel>
      </header>

      <DeliverySummaryStrip
        forecast={forecast}
        context={context}
        timezone={value.timezone}
        now={now}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-7">
          <StartChoice
            value={value}
            onChange={onChange}
            issues={issues}
            showErrors={showAllErrors}
            now={now}
            browserZone={browserZone}
            disabled={readOnly}
          />
          <HoursPicker value={value} onChange={onChange} issues={issues} disabled={readOnly} />
          <PacePicker
            value={value}
            onChange={onChange}
            context={context}
            now={now}
            disabled={readOnly}
          />
          <AdvancedSettings
            value={value}
            onChange={onChange}
            forecast={forecast}
            context={context}
            issues={issues.filter(
              (i) => i.field === 'pace' || i.field === 'dailyLimit' || i.field === 'deadline',
            )}
            showErrors={showAllErrors}
            now={now}
            disabled={readOnly}
          />
        </div>

        <aside className="flex flex-col gap-2 lg:sticky lg:top-6" aria-label="Resumo do envio">
          <DeliverySummary
            value={value}
            forecast={forecast}
            context={context}
            status={status}
            now={now}
            onEditAudience={onEditAudience}
            contactQuietHours={contactQuietHours}
          />
        </aside>
      </div>
    </div>
  );
}
