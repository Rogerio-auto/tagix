/**
 * Motivo da sugestão do piloto automático, por modelo de texto (F73-S13; COPILOTO.md §7.2).
 *
 * Linguagem de negócio, sem nome, telefone ou valor do cliente (o texto vai para o Briefing e para
 * a lista de aprovação) e NUNCA um número de score ("0,82"). O que aparece são fatos que a pessoa
 * confere sozinha: há quantos dias o cliente não responde, quem falou por último e quando.
 *
 *   "Sem resposta há 9 dias; a última mensagem foi nossa, em 07/10. Já passou do tempo típico ..."
 *
 * Duas famílias de texto (pt e en, como o Briefing: `locale` do workspace começa com `pt` ou não).
 * A data sai no fuso do workspace.
 */
import type { DealLastMessageDirection } from '../../repos/copilot/idle';
import type { ConfidenceBasis, ConfidenceLevel } from './confidence';

/** Código estável do motivo (a interface pode mapear ícone/rótulo; o texto já vem pronto). */
export type SuggestionReasonCode = 'idle_last_outbound' | 'idle_last_inbound' | 'idle_no_messages';

export interface ReasonInput {
  /** Dias parado (`dealIdleDaysSql`): desde a última mensagem do contato. */
  readonly idleDays: number;
  /** Direção da última mensagem da conversa do negócio; `null` sem conversa ou sem mensagem. */
  readonly lastDirection: DealLastMessageDirection | null;
  /** Instante da última mensagem (qualquer direção); `null` junto com `lastDirection`. */
  readonly lastMessageAt: Date | null;
  /** `workspaces.locale` (ex.: `pt-BR`). */
  readonly locale: string;
  /** `workspaces.timezone` (ex.: `America/Sao_Paulo`). */
  readonly timeZone: string;
}

export interface Reason {
  readonly code: SuggestionReasonCode;
  /** Primeira frase, sem a confiança. */
  readonly text: string;
}

type Family = 'pt' | 'en';

function familyOf(locale: string): Family {
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** `dd/MM` (pt) ou `MM/dd` (en) no fuso do workspace; fuso inválido cai para UTC. */
export function formatShortDate(at: Date, locale: string, timeZone: string): string {
  const tag = familyOf(locale) === 'pt' ? 'pt-BR' : 'en-US';
  const build = (tz: string): string =>
    new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', timeZone: tz }).format(at);
  try {
    return build(timeZone);
  } catch {
    return build('UTC');
  }
}

function days(family: Family, n: number): string {
  if (family === 'pt') return n === 1 ? '1 dia' : `${n} dias`;
  return n === 1 ? '1 day' : `${n} days`;
}

/** Primeira frase do motivo e o código dela. */
export function buildReason(input: ReasonInput): Reason {
  const family = familyOf(input.locale);
  const idle = Math.max(0, Math.trunc(input.idleDays));
  const when = input.lastMessageAt
    ? formatShortDate(input.lastMessageAt, input.locale, input.timeZone)
    : null;

  if (input.lastDirection === 'outbound' && when) {
    return {
      code: 'idle_last_outbound',
      text:
        family === 'pt'
          ? `Sem resposta há ${days(family, idle)}; a última mensagem foi nossa, em ${when}.`
          : `No reply for ${days(family, idle)}; the last message was ours, on ${when}.`,
    };
  }
  if (input.lastDirection === 'inbound' && when) {
    return {
      code: 'idle_last_inbound',
      text:
        family === 'pt'
          ? `Sem retorno nosso há ${days(family, idle)}; a última mensagem foi do cliente, em ${when}.`
          : `No follow-up from us for ${days(family, idle)}; the last message was the customer's, on ${when}.`,
    };
  }
  return {
    code: 'idle_no_messages',
    text:
      family === 'pt'
        ? `Sem movimentação há ${days(family, idle)}.`
        : `No activity for ${days(family, idle)}.`,
  };
}

const CONFIDENCE_SENTENCES: Record<Family, Record<ConfidenceLevel | 'thin', string>> = {
  pt: {
    high: 'Já passou do tempo em que quase todos os negócios ganhos deixaram este estágio.',
    medium:
      'Já passou do tempo típico dos negócios ganhos neste estágio, mas alguns ainda avançaram depois.',
    low: 'Ainda está dentro do tempo típico dos negócios ganhos neste estágio.',
    thin: 'Confiança média: pouco histórico de negócios ganhos neste estágio.',
  },
  en: {
    high: 'It is past the time in which almost every won deal left this stage.',
    medium:
      'It is past the typical time of won deals in this stage, but some still moved on afterwards.',
    low: 'It is still within the typical time of won deals in this stage.',
    thin: 'Medium confidence: little history of won deals in this stage.',
  },
};

/** Frase que explica a confiança (a base: histórico suficiente ou "pouco histórico"). */
export function confidenceSentence(
  locale: string,
  level: ConfidenceLevel,
  basis: ConfidenceBasis,
): string {
  const family = familyOf(locale);
  return CONFIDENCE_SENTENCES[family][basis === 'thin_history' ? 'thin' : level];
}

/** Máximo aceito pelo banco (`copilot_suggestions_reason_text_chk`). */
export const REASON_TEXT_MAX = 280;

/** Texto final gravado em `reason_text`: motivo + confiança, dentro do limite do banco. */
export function composeReasonText(reason: Reason, confidence: string): string {
  const full = `${reason.text} ${confidence}`;
  if (full.length <= REASON_TEXT_MAX) return full;
  return reason.text.length <= REASON_TEXT_MAX
    ? reason.text
    : `${reason.text.slice(0, REASON_TEXT_MAX - 1)}…`;
}
