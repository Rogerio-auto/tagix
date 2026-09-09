/**
 * Portão de envio (F59-S04 — AGENCIA_PLAN.md §4.4).
 *
 * Uma função pura decide se uma mensagem pode sair. É PURA de propósito: recebe
 * `now` e o snapshot já carregado, não consulta banco nem lê o relógio. O I/O fica
 * no serviço que a chama (`apps/api/src/services/consent`), e o worker chama o
 * serviço. Assim a regra — que é a parte com consequência jurídica — é testável
 * sem banco, sem fuso do servidor e sem mock.
 *
 * A recusa NUNCA é silenciosa: todo `allowed: false` carrega motivo enum estável
 * (vira métrica) e mensagem pronta para log e para o atendente. Recusar em
 * silêncio é o pior resultado possível — o cliente acha que disparou e não disparou.
 */

import {
  getMarketPack,
  getOutboundPolicy,
  isChannelEnabled,
  type ChannelKind,
  type MarketCode,
  type MessagePurpose,
} from './markets';

/** Estado do registro externo do canal (ex.: marca + campanha 10DLC). */
export type ChannelRegistrationStatus = 'none' | 'pending' | 'approved';

/** Motivos de recusa. Enum estável: vira rótulo de métrica e não pode virar string livre. */
export type OutboundDenyReason =
  | 'suppressed'
  | 'no_consent'
  | 'quiet_hours'
  | 'registration_pending'
  | 'channel_disabled';

/** O que o repositório de consentimento entrega ao portão. */
export interface ConsentSnapshot {
  readonly suppressedGlobally: boolean;
  readonly suppressedOnChannel: boolean;
  readonly marketingStatus: 'granted' | 'revoked' | 'never';
  readonly grantedAt: Date | null;
}

export interface OutboundDecisionInput {
  readonly market: MarketCode;
  readonly channel: ChannelKind;
  readonly purpose: MessagePurpose;
  readonly consent: ConsentSnapshot;
  /** IANA. `null` = usar o `defaultTimezone` do market pack. */
  readonly contactTimezone: string | null;
  readonly channelRegistration: ChannelRegistrationStatus;
  readonly now: Date;
}

export type OutboundDecision =
  | {
      readonly allowed: true;
      /** Fuso efetivamente usado — `true` quando caiu no padrão do mercado. */
      readonly usedFallbackTimezone: boolean;
      readonly timezone: string;
    }
  | {
      readonly allowed: false;
      readonly reason: OutboundDenyReason;
      readonly message: string;
      /** Preenchido em `quiet_hours`: o chamador REAGENDA, não descarta. */
      readonly retryAt?: Date;
      readonly usedFallbackTimezone: boolean;
      readonly timezone: string;
    };

/**
 * Hora local do instante `now` no fuso IANA informado.
 *
 * Usa `Intl.DateTimeFormat` com `timeZone` em vez de aritmética de offset: offset
 * fixo erra no horário de verão, e horário de verão é exatamente onde uma
 * implementação ingênua manda mensagem fora da janela legal.
 */
export function localHourIn(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const parsed = Number(hour);
  // `hourCycle` h23 devolve 24 para meia-noite em alguns ambientes.
  return Number.isFinite(parsed) ? parsed % 24 : 0;
}

/** Lê um campo de `formatToParts` sem passar por índice de objeto. */
function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((p) => p.type === type)?.value;
  const n = Number(found);
  return Number.isFinite(n) ? n : 0;
}

/** Deslocamento do fuso, em minutos, no instante dado. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const asUtc = Date.UTC(
    part(parts, 'year'),
    part(parts, 'month') - 1,
    part(parts, 'day'),
    part(parts, 'hour') % 24,
    part(parts, 'minute'),
    part(parts, 'second'),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Próximo instante em que a janela abre, no fuso do contato.
 *
 * Recalcula o offset depois de posicionar o alvo: numa virada de horário de verão,
 * o offset do momento do envio não é o mesmo do momento atual.
 */
function nextWindowOpening(timeZone: string, at: Date, startHour: number): Date {
  const hour = localHourIn(timeZone, at);
  const base = new Date(at.getTime());
  // Se já passou da janela hoje, mira amanhã; se ainda não abriu, mira hoje.
  const dias = hour >= startHour ? 1 : 0;
  const alvo = new Date(base.getTime() + dias * 86_400_000);

  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(alvo);
  const naiveUtc = Date.UTC(part(p, 'year'), part(p, 'month') - 1, part(p, 'day'), startHour, 0, 0);
  const aproximado = new Date(naiveUtc - offsetMinutes(timeZone, alvo) * 60_000);
  // Segunda passada: usa o offset vigente no próprio instante alvo.
  return new Date(naiveUtc - offsetMinutes(timeZone, aproximado) * 60_000);
}

/**
 * Decide se a mensagem pode sair.
 *
 * Ordem FIXA e testada — supressão primeiro, sempre:
 *   1. supressão (global ou de canal)  → vence tudo, inclusive transacional
 *   2. canal habilitado no mercado
 *   3. registro externo aprovado (10DLC)
 *   4. consentimento                   → só para `marketing`
 *   5. janela horária no fuso do contato
 *
 * `transactional` nunca é bloqueado por `no_consent`: confirmação de agendamento
 * não é marketing, e travar isso derruba a operação do cliente.
 */
export function decideOutbound(input: OutboundDecisionInput): OutboundDecision {
  const pack = getMarketPack(input.market);
  const policy = getOutboundPolicy(input.market, input.channel);
  const usedFallbackTimezone = input.contactTimezone === null;
  const timezone = input.contactTimezone ?? pack.defaultTimezone;
  const ctx = { usedFallbackTimezone, timezone };

  if (input.consent.suppressedGlobally) {
    return {
      allowed: false,
      reason: 'suppressed',
      message: 'Contato pediu para não receber mais mensagens desta empresa.',
      ...ctx,
    };
  }

  if (input.consent.suppressedOnChannel) {
    return {
      allowed: false,
      reason: 'suppressed',
      message: `Contato pediu para não receber mensagens por ${input.channel}.`,
      ...ctx,
    };
  }

  if (!isChannelEnabled(input.market, input.channel)) {
    return {
      allowed: false,
      reason: 'channel_disabled',
      message: `O canal ${input.channel} não está disponível no mercado ${input.market}.`,
      ...ctx,
    };
  }

  if (policy.registrationRequired !== 'none' && input.channelRegistration !== 'approved') {
    return {
      allowed: false,
      reason: 'registration_pending',
      message:
        `Envio por ${input.channel} exige registro ${policy.registrationRequired.toUpperCase()} ` +
        'aprovado. Enquanto o registro não sai, as operadoras bloqueiam 100% do tráfego.',
      ...ctx,
    };
  }

  if (input.purpose === 'marketing' && policy.requiresPriorConsent) {
    if (input.consent.marketingStatus !== 'granted') {
      return {
        allowed: false,
        reason: 'no_consent',
        message:
          'Não há consentimento registrado deste contato para mensagens de marketing ' +
          `por ${input.channel}.`,
        ...ctx,
      };
    }
  }

  if (policy.quietHours !== null) {
    const hora = localHourIn(timezone, input.now);
    const { startHour, endHour } = policy.quietHours;
    const dentro = hora >= startHour && hora < endHour;
    if (!dentro) {
      return {
        allowed: false,
        reason: 'quiet_hours',
        message:
          `Fora da janela permitida (${startHour}h–${endHour}h no fuso do contato, ` +
          `${timezone}). São ${hora}h para ele.`,
        retryAt: nextWindowOpening(timezone, input.now, startHour),
        ...ctx,
      };
    }
  }

  return { allowed: true, ...ctx };
}
