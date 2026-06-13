/**
 * Metrica OTel de mensagens IG recebidas por tipo (F15-S03, INSTAGRAM.md 14).
 * Reusa o meter compartilhado (@hm/logger) — fora de observability/**.
 */
import { getMeter } from '@hm/logger';

const meter = getMeter('@hm/workers');

const received = meter.createCounter('hm.ig.messages.received', {
  description: 'Mensagens Instagram recebidas, por subtipo.',
});

/** Conta uma mensagem IG recebida de um subtipo (dm/story_mention/comment/...). */
export function recordIgMessageReceived(type: string): void {
  received.add(1, { type });
}
