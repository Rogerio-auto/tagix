/**
 * Enforcement da janela de mensagens do Instagram (INSTAGRAM.md §6).
 *
 * Regras (diferentes de WhatsApp — IG não tem HSM):
 *   - última inbound < 24h         -> envia qualquer tipo (RESPONSE).
 *   - 24h <= última inbound < 7d    -> só com MESSAGE_TAG válido (ex.: HUMAN_AGENT).
 *   - >= 7d                          -> impossível enviar (bloqueado).
 *   - sem dado de última inbound     -> trata como dentro da janela (best-effort;
 *                                       a borda/worker pode não conhecer o timestamp).
 *
 * Função pura — testável sem DB/HTTP. O worker chama antes do dispatch real e,
 * se bloqueado, NÃO chama a borda Meta (vira SendResult falho tipado + métrica).
 */
import type { IgMessageTag } from './job';

const HOUR_MS = 3_600_000;
const WINDOW_24H_MS = 24 * HOUR_MS;
const WINDOW_7D_MS = 7 * 24 * HOUR_MS;

/** Tags válidas para envio fora da janela 24h (até 7d). */
const VALID_OUTSIDE_WINDOW_TAGS: ReadonlySet<IgMessageTag> = new Set<IgMessageTag>([
  'HUMAN_AGENT',
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
]);

export interface WindowEvaluation {
  /** `true` = pode enviar; `false` = bloqueado (não chamar a borda). */
  readonly allowed: boolean;
  /** Modo resultante (espelha o composer do frontend). */
  readonly mode: 'open' | 'tag_required' | 'blocked';
  /** Tag a aplicar no envio (presente só quando allowed por tag). */
  readonly tag?: IgMessageTag;
  /** Motivo legível quando bloqueado. */
  readonly reason?: string;
}

export interface WindowInput {
  /** Epoch-ms da última inbound do contato (undefined = desconhecido). */
  readonly lastInboundFromContactAt?: number;
  /** Tag fornecida no job (se houver). */
  readonly messageTag?: IgMessageTag;
  /** Relógio injetável (testes). Default Date.now(). */
  readonly now?: number;
}

/** Avalia a janela e decide se o envio IG é permitido. */
export function evaluateInstagramWindow(input: WindowInput): WindowEvaluation {
  const now = input.now ?? Date.now();
  const last = input.lastInboundFromContactAt;

  // Sem timestamp conhecido: best-effort dentro da janela (open).
  if (last === undefined) {
    return input.messageTag !== undefined
      ? { allowed: true, mode: 'open', tag: input.messageTag }
      : { allowed: true, mode: 'open' };
  }

  const elapsed = now - last;

  if (elapsed < WINDOW_24H_MS) {
    return input.messageTag !== undefined
      ? { allowed: true, mode: 'open', tag: input.messageTag }
      : { allowed: true, mode: 'open' };
  }

  if (elapsed < WINDOW_7D_MS) {
    const tag = input.messageTag;
    if (tag !== undefined && VALID_OUTSIDE_WINDOW_TAGS.has(tag)) {
      return { allowed: true, mode: 'tag_required', tag };
    }
    return {
      allowed: false,
      mode: 'tag_required',
      reason: '24h_window_expired_ig',
    };
  }

  return { allowed: false, mode: 'blocked', reason: 'ig_messaging_window_closed' };
}
