/**
 * Estado do composer a partir da restrição de envio da API (F60-S11).
 *
 * Régua do slot: o atendente nunca abre chamado achando que o envio travou por
 * defeito. Para isso a tela precisa dizer **por quê** e **quando volta a poder**.
 *
 * Regra dura: a interface NÃO decide bloqueio. `composerGate` só traduz os campos
 * que a API já decidiu (`restriction.canSend`, `restriction.reason` e as flags da
 * janela) em modo de tela. O texto por motivo é apresentação do enum estável do
 * portão, não regra.
 */
import type { SendRestrictionReason, WindowResponse } from './useWindowState';

/** Motivos que travam o composer — vindos do portão de consentimento. */
export type BlockingReason = Exclude<SendRestrictionReason, 'ok' | 'provider_window'>;

export type ComposerGate =
  /** Ainda sem resposta (carregando/erro): não trava — a API é a autoridade no envio. */
  | { kind: 'unknown' }
  | { kind: 'open' }
  /** Instagram fora da janela: envio liberado, marcado com a tag de atendimento humano. */
  | { kind: 'tagged' }
  /** WhatsApp fora da janela de 24h: só um modelo aprovado reabre a conversa. */
  | { kind: 'template' }
  /** O portão recusou: travado, com motivo e (quando houver) horário de liberação. */
  | {
      kind: 'blocked';
      /** `null` só se a API mandar um motivo que esta versão da tela não conhece. */
      reason: BlockingReason | null;
      message: string;
      retryAt: string | null;
    };

const BLOCKING_REASONS: ReadonlySet<string> = new Set<BlockingReason>([
  'suppressed',
  'no_consent',
  'quiet_hours',
  'registration_pending',
  'channel_disabled',
]);

function isBlockingReason(reason: SendRestrictionReason): reason is BlockingReason {
  return BLOCKING_REASONS.has(reason);
}

export function composerGate(data: WindowResponse | undefined): ComposerGate {
  if (!data) return { kind: 'unknown' };
  const { window, restriction } = data;

  // API anterior à F60-S02 (descompasso de deploy): só existe a janela do provider.
  if (restriction === undefined) {
    if (window.requiresTemplate) return { kind: 'template' };
    if (window.messageTag !== null) return { kind: 'tagged' };
    return { kind: 'open' };
  }

  // O portão vence a janela (decidido na API): recusa trava o composer.
  if (!restriction.canSend) {
    // `canSend: false` sempre vem com motivo do portão. Se vier um que esta tela
    // não conhece, continua sendo bloqueio — com texto genérico, não inventado.
    return {
      kind: 'blocked',
      reason: isBlockingReason(restriction.reason) ? restriction.reason : null,
      message: restriction.message,
      retryAt: restriction.retryAt,
    };
  }

  if (restriction.reason === 'provider_window') {
    return window.requiresTemplate ? { kind: 'template' } : { kind: 'tagged' };
  }
  return { kind: 'open' };
}

/** Tom visual do aviso: recusa por pedido do contato não é erro nem alerta. */
export type RestrictionTone = 'neutral' | 'warn' | 'info';

export interface RestrictionCopy {
  title: string;
  /** Deixa explícito que é regra, não falha — a régua do slot. */
  reassurance: string;
  /** "Quando volta a poder" quando não há `retryAt`. */
  until: string;
  tone: RestrictionTone;
}

const COPY: Readonly<Record<BlockingReason, RestrictionCopy>> = {
  suppressed: {
    title: 'Envio travado a pedido do contato',
    reassurance: 'Não é uma falha do sistema: o envio está travado para respeitar o pedido dele.',
    until: 'Sem previsão de liberação: o bloqueio vale até o contato autorizar de novo.',
    tone: 'neutral',
  },
  no_consent: {
    title: 'Envio travado: falta consentimento',
    reassurance: 'Não é uma falha do sistema: a lei exige autorização antes deste tipo de envio.',
    until: 'Libera quando o consentimento do contato for registrado.',
    tone: 'neutral',
  },
  quiet_hours: {
    title: 'Envio travado: fora do horário permitido',
    reassurance: 'Não é uma falha do sistema: há horário legal de envio no fuso do contato.',
    until: 'Libera quando abrir o horário permitido no fuso do contato.',
    tone: 'warn',
  },
  registration_pending: {
    title: 'Envio travado: registro do canal pendente',
    reassurance: 'Não é uma falha do sistema: as operadoras só entregam depois do registro.',
    until: 'Libera quando o registro do canal for aprovado.',
    tone: 'info',
  },
  channel_disabled: {
    title: 'Envio travado: canal indisponível',
    reassurance: 'Não é uma falha do sistema: o canal não está habilitado neste mercado.',
    until: 'Não libera com o tempo: fale com o administrador do workspace.',
    tone: 'info',
  },
};

const UNSPECIFIED: RestrictionCopy = {
  title: 'Envio travado para esta conversa',
  reassurance: 'O sistema recusou o envio por uma regra do canal, não por falha.',
  until: 'Sem previsão de liberação informada.',
  tone: 'neutral',
};

export function restrictionCopy(reason: BlockingReason | null): RestrictionCopy {
  return reason === null ? UNSPECIFIED : COPY[reason];
}

/**
 * Idioma da DATA acompanha o idioma do TEXTO deste módulo, que é pt-BR fixo:
 * "amanhã às 8:00 AM" seria pior que qualquer um dos dois. Quando a interface
 * ganhar i18n pelo market pack, os dois mudam juntos.
 * TODO(i18n · limpeza DS/i18n): ler do market pack do workspace.
 */
const COPY_LOCALE = 'pt-BR';

/** Chave de dia civil (ano-mês-dia) no fuso, independente de idioma. */
function dayKey(date: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * "hoje às 08:00", "amanhã às 08:00" ou "seg., 12/10 às 08:00" no fuso de quem
 * está olhando a tela. `timeZone` existe para o teste ser determinístico.
 * Data inválida devolve `null` — melhor não dizer horário do que dizer um errado.
 */
export function formatRetryAt(
  iso: string,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const time = new Intl.DateTimeFormat(COPY_LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);

  const today = dayKey(now, timeZone);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  const target = dayKey(at, timeZone);

  if (target === today) return `hoje às ${time}`;
  if (target === tomorrow) return `amanhã às ${time}`;

  const day = new Intl.DateTimeFormat(COPY_LOCALE, {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(at);
  return `${day} às ${time}`;
}

/** Linha "quando volta a poder": horário exato quando a API informa, senão a condição. */
export function untilLine(
  gate: Extract<ComposerGate, { kind: 'blocked' }>,
  now?: Date,
  timeZone?: string,
): string {
  if (gate.retryAt !== null) {
    const when = formatRetryAt(gate.retryAt, now, timeZone);
    if (when !== null) return `Volta a poder ${when}.`;
  }
  return restrictionCopy(gate.reason).until;
}
