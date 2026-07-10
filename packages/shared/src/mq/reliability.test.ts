/**
 * F56-S12 — cobre as duas peças finalizadas na integração:
 *  - `reliableQueues()` estendida (INF-03/DB-07): as filas de trabalho não fazem
 *    mais nack-drop silencioso.
 *  - publish ciente de backpressure (INF-12): aguarda `drain` e contabiliza.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, beforeEach } from 'vitest';
import { reliableQueues, isReliableQueue, defaultPolicyForQueue } from './retry';
import { QUEUES } from './topology';
import { sendToQueueWithBackpressure } from './publish';
import { mqStats, resetMqStats } from './stats';

describe('reliableQueues (INF-03/DB-07)', () => {
  it('cobre todas as filas de trabalho — não só inbound/outbound/media', () => {
    const q = reliableQueues();
    for (const name of [
      QUEUES.inbound,
      QUEUES.outbound,
      QUEUES.media,
      QUEUES.flows,
      QUEUES.flowExecution,
      QUEUES.campaigns,
      QUEUES.coexistence,
      QUEUES.kbIngest,
    ]) {
      expect(q).toContain(name);
      expect(isReliableQueue(name)).toBe(true);
      // fila confiável → política de retry (não `null` = nack-drop)
      expect(defaultPolicyForQueue(name)).not.toBeNull();
    }
  });

  it('flows/campaigns/coexistence deixam de cair no ramo nack-drop', () => {
    expect(defaultPolicyForQueue(QUEUES.flows)).not.toBeNull();
    expect(defaultPolicyForQueue(QUEUES.campaigns)).not.toBeNull();
    expect(defaultPolicyForQueue(QUEUES.coexistence)).not.toBeNull();
  });
});

/** Canal fake: `sendToQueue` devolve o boolean programado e emite `drain`. */
class FakeChannel extends EventEmitter {
  constructor(private readonly ok: boolean) {
    super();
  }
  sendToQueue(): boolean {
    return this.ok;
  }
}

describe('sendToQueueWithBackpressure (INF-12)', () => {
  beforeEach(() => resetMqStats());

  it('não bloqueia nem contabiliza quando há espaço no buffer', async () => {
    const ch = new FakeChannel(true);
    await sendToQueueWithBackpressure(ch as never, QUEUES.flows, { type: 't' } as never);
    expect(mqStats().publishBackpressure).toBe(0);
  });

  it('aguarda drain e contabiliza quando o buffer está cheio', async () => {
    const ch = new FakeChannel(false);
    const pending = sendToQueueWithBackpressure(ch as never, QUEUES.flows, { type: 't' } as never);
    // ainda não resolveu: depende do evento drain
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    ch.emit('drain');
    await pending;
    expect(mqStats().publishBackpressure).toBe(1);
  });
});
