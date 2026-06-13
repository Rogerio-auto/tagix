/**
 * Metricas OTel especificas do outbound Instagram (INSTAGRAM.md 14). Mantidas
 * fora de observability/** (reuso do meter compartilhado via @hm/logger). So
 * IG: tag usada e bloqueio de janela.
 */
import { getMeter } from '@hm/logger';
import type { IgMessageTag } from './job';

const meter = getMeter('@hm/workers');

const messageTagUsed = meter.createCounter('hm.ig.outbound.message_tag_used', {
  description: 'Envios IG fora da janela 24h usando MESSAGE_TAG, por tag.',
});

const windowBlocked = meter.createCounter('hm.ig.window.outbound_blocked', {
  description: 'Tentativas de envio IG bloqueadas por janela de mensagens fechada.',
});

/** Conta um envio IG que usou MESSAGE_TAG. */
export function recordIgMessageTagUsed(tag: IgMessageTag): void {
  messageTagUsed.add(1, { tag });
}

/** Conta um envio IG bloqueado pela janela. */
export function recordIgWindowBlocked(): void {
  windowBlocked.add(1);
}
