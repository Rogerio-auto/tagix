/**
 * O que fazer com o retorno do provedor (F60-S08 — CANAIS_PLAN §4.2).
 *
 * Duas decisões erradas, ambas caras e em direções opostas:
 *
 * - **Não suprimir bounce duro** é o caminho mais rápido para queimar o domínio
 *   do cliente. Continuar mandando para endereço inexistente derruba a reputação
 *   e, quando ela cai, a confirmação de agendamento de quem existe para de chegar.
 * - **Suprimir bounce leve** é o caminho mais rápido para perder um cliente que
 *   só estava de férias com a caixa cheia. Ele volta em uma semana e nunca mais
 *   recebe nada, e ninguém descobre por quê.
 *
 * A distinção entre os dois é a razão deste módulo existir separado, puro e
 * testado — em vez de um `if` no meio da rota de webhook.
 */
import type { EmailEvent, EmailEventKind } from './provider';

export type BounceAction =
  /** Suprime o endereço no canal de e-mail, de imediato e para sempre. */
  | 'suppress'
  /** Marca a tentativa e deixa o endereço vivo. */
  | 'record'
  /** Só atualiza o estado de entrega da mensagem. */
  | 'none';

export interface BounceDecision {
  readonly action: BounceAction;
  /** Vai para `contact_suppressions.reason` quando suprime. */
  readonly reason: string;
  /** Pronta para o log e para a tela de saúde de entrega. */
  readonly message: string;
}

/**
 * Quantas falhas transitórias seguidas antes de tratar o endereço como morto.
 *
 * Bounce leve repetido deixa de ser transitório em algum ponto — caixa que está
 * cheia há duas semanas não vai esvaziar. O número é conservador de propósito:
 * errar para o lado de continuar tentando custa entrega; errar para o lado de
 * suprimir custa o cliente.
 */
export const SOFT_BOUNCE_LIMIT = 5;

export function decideOnEmailEvent(
  event: EmailEvent,
  softBounceCount = 0,
): BounceDecision {
  switch (event.kind) {
    case 'hard_bounce':
      // Endereço não existe. Insistir é o que queima o domínio.
      return {
        action: 'suppress',
        reason: 'hard_bounce',
        message: `Endereço ${event.recipient} não existe ou recusou permanentemente.`,
      };

    case 'complaint':
      // A pessoa clicou em "isto é spam". Suprimir aqui não é conservadorismo —
      // é o único caminho: reclamação é o sinal mais caro que existe para o
      // provedor, e mais uma custa mais que o cliente inteiro.
      return {
        action: 'suppress',
        reason: 'complaint',
        message: `${event.recipient} marcou a mensagem como spam.`,
      };

    case 'soft_bounce':
      if (softBounceCount + 1 >= SOFT_BOUNCE_LIMIT) {
        return {
          action: 'suppress',
          reason: 'soft_bounce_exhausted',
          message:
            `${event.recipient} falhou ${softBounceCount + 1} vezes seguidas por motivo ` +
            'transitório. Caixa cheia há tanto tempo não vai esvaziar.',
        };
      }
      return {
        action: 'record',
        reason: 'soft_bounce',
        message:
          `Falha transitória para ${event.recipient} ` +
          `(${softBounceCount + 1} de ${SOFT_BOUNCE_LIMIT}). Endereço segue ativo.`,
      };

    case 'delivered':
    case 'opened':
    case 'clicked':
      return { action: 'none', reason: event.kind, message: '' };

    default:
      return exhaustive(event.kind);
  }
}

function exhaustive(kind: never): never {
  throw new Error(`Evento de e-mail não tratado: ${JSON.stringify(kind)}`);
}

/** Entrega bem-sucedida zera a contagem de falhas transitórias. */
export function resetsSoftBounces(kind: EmailEventKind): boolean {
  return kind === 'delivered';
}
