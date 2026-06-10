/**
 * Extração de um id estável de evento para dedup (F1-S02).
 *
 * Um POST de webhook pode carregar vários eventos, mas a Meta reentrega o MESMO
 * envelope inteiro em caso de timeout/erro. Portanto deduplicamos a ENTREGA: se
 * houver um id de mensagem/status do provider (wamid no WA, mid no IG, id no
 * WAHA), usamos o primeiro; senão, derivamos um hash determinístico do corpo
 * bruto. Em ambos os casos a chave é estável entre reentregas idênticas.
 *
 * O parse completo e por-evento é responsabilidade do worker-inbound; aqui só
 * precisamos de uma chave de idempotência barata e sem `any`.
 */
import { createHash } from 'node:crypto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Procura recursivamente o primeiro id de mensagem/status conhecido. */
function findProviderId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || !isRecord(value)) return undefined;

  // WhatsApp Cloud: messages[].id / statuses[].id (= wamid). Instagram: message.mid.
  for (const key of ['id', 'mid'] as const) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0 && key in value) {
      // Só aceitamos id/mid de objetos que parecem ser mensagens/status
      // (têm timestamp ou from), evitando o `entry.id` (id da conta).
      if ('timestamp' in value || 'from' in value || 'status' in value || 'text' in value) {
        return candidate;
      }
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findProviderId(item, depth + 1);
        if (found) return found;
      }
    } else if (isRecord(nested)) {
      const found = findProviderId(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Deriva o id de dedup a partir do corpo bruto (Buffer recebido) e do JSON já
 * parseado. Prefere o id do provider; cai para um hash sha256 do corpo bruto.
 */
export function deriveEventId(rawBody: Buffer, parsed: unknown): string {
  const providerId = findProviderId(parsed);
  if (providerId) return providerId;
  return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
}
