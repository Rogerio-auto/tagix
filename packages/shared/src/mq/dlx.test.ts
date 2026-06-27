/**
 * Testes da malha de entrega resiliente (DLX + retry + DLQ) — F52-S03.
 *
 * A maioria roda contra um `FakeChannel` em memória que SIMULA fielmente o
 * round-trip do broker (wait-queue → TTL expira → dead-letter de volta à origem)
 * usando exatamente os x-arguments que a topology declara. Assim os testes são
 * rápidos e determinísticos, mas exercitam a configuração real.
 *
 * Há também um bloco de integração contra um RabbitMQ de verdade, ativado por
 * `MQ_IT=1` (usa AMQP_URL ou amqp://hm:hm@localhost:5672).
 */
import { Buffer } from 'node:buffer';
import type { Channel, ConsumeMessage } from 'amqplib';
import { describe, expect, it } from 'vitest';
import { makeEnvelope, type Envelope } from './envelope';
import { assertTopology, EXCHANGES, QUEUES } from './topology';
import { consume } from './index';
import {
  assertDlq,
  assertRetryTopology,
  DLQ_QUEUE,
  DLQ_REASON_HEADER,
  ORIGIN_QUEUE_HEADER,
  NonRetryableError,
  RETRY_BACKOFF_MS,
  RETRY_COUNT_HEADER,
  retryWaitQueueName,
} from './retry';
import { inspectDlq, replayDlq } from './dlq';

const WORKSPACE = '00000000-0000-0000-0000-000000000001';

type Headers = Record<string, unknown>;
interface PublishOpts {
  readonly headers?: Headers;
  readonly contentType?: string;
  readonly persistent?: boolean;
}
interface StoredMsg {
  content: Buffer;
  fields: { deliveryTag: number; redelivered: boolean; exchange: string; routingKey: string };
  properties: { headers: Headers; contentType?: string };
}
interface QueueState {
  args: Headers;
  messages: StoredMsg[];
}

/**
 * Broker em memória. Modela só o que `consume`/retry/dlq usam, mas a expiração
 * da wait-queue e o dead-letter seguem os x-arguments declarados — então o teste
 * prova que a topology foi configurada certo.
 */
class FakeChannel {
  readonly queues = new Map<string, QueueState>();
  readonly exchanges: { name: string; type: string }[] = [];
  readonly bindings: { queue: string; exchange: string; pattern: string }[] = [];
  readonly acks: StoredMsg[] = [];
  readonly nacks: { msg: StoredMsg; requeue: boolean }[] = [];
  private readonly consumers = new Map<string, (msg: ConsumeMessage | null) => void>();
  private readonly inFlight = new WeakMap<StoredMsg, string>();
  private tag = 0;

  private ensureQueue(name: string): QueueState {
    let q = this.queues.get(name);
    if (!q) {
      q = { args: {}, messages: [] };
      this.queues.set(name, q);
    }
    return q;
  }

  private makeStored(content: Buffer, opts: PublishOpts | undefined, routingKey: string): StoredMsg {
    this.tag += 1;
    const properties: StoredMsg['properties'] = { headers: { ...(opts?.headers ?? {}) } };
    if (opts?.contentType !== undefined) properties.contentType = opts.contentType;
    return {
      content,
      fields: { deliveryTag: this.tag, redelivered: false, exchange: '', routingKey },
      properties,
    };
  }

  private enqueue(queue: string, msg: StoredMsg): void {
    const q = this.ensureQueue(queue);
    const consumer = this.consumers.get(queue);
    if (consumer) {
      this.inFlight.set(msg, queue);
      setImmediate(() => consumer(msg as unknown as ConsumeMessage));
      return;
    }
    q.messages.push(msg);
    const ttl = q.args['x-message-ttl'];
    const dlrk = q.args['x-dead-letter-routing-key'];
    if (typeof ttl === 'number' && typeof dlrk === 'string') {
      // wait-queue: simula expiração do TTL → dead-letter de volta à origem.
      setImmediate(() => {
        const idx = q.messages.indexOf(msg);
        if (idx >= 0) q.messages.splice(idx, 1);
        msg.fields.redelivered = true;
        this.enqueue(dlrk, msg);
      });
    }
  }

  // --- API que imita amqplib.Channel (subconjunto usado) ---

  assertExchange(name: string, type: string): Promise<unknown> {
    if (!this.exchanges.some((e) => e.name === name)) this.exchanges.push({ name, type });
    return Promise.resolve({ exchange: name });
  }

  assertQueue(name: string, opts?: { durable?: boolean; arguments?: Headers }): Promise<unknown> {
    const q = this.ensureQueue(name);
    if (opts?.arguments) q.args = { ...q.args, ...opts.arguments };
    return Promise.resolve({ queue: name, messageCount: q.messages.length, consumerCount: 0 });
  }

  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown> {
    if (!this.bindings.some((b) => b.queue === queue && b.exchange === exchange && b.pattern === pattern)) {
      this.bindings.push({ queue, exchange, pattern });
    }
    return Promise.resolve({});
  }

  consume(queue: string, cb: (msg: ConsumeMessage | null) => void): Promise<unknown> {
    this.ensureQueue(queue);
    this.consumers.set(queue, cb);
    return Promise.resolve({ consumerTag: `ct-${queue}` });
  }

  ack(msg: StoredMsg): void {
    this.acks.push(msg);
    this.inFlight.delete(msg);
  }

  nack(msg: StoredMsg, _allUpTo: boolean, requeue: boolean): void {
    this.nacks.push({ msg, requeue });
    const origin = this.inFlight.get(msg);
    this.inFlight.delete(msg);
    if (requeue && origin) this.enqueue(origin, msg);
  }

  sendToQueue(queue: string, content: Buffer, opts?: PublishOpts): boolean {
    this.enqueue(queue, this.makeStored(content, opts, queue));
    return true;
  }

  publish(exchange: string, routingKey: string, content: Buffer, opts?: PublishOpts): boolean {
    if (exchange === EXCHANGES.dlx) {
      const target = routingKey === 'hm.dlq' ? DLQ_QUEUE : routingKey;
      this.enqueue(target, this.makeStored(content, opts, routingKey));
    }
    return true;
  }

  get(queue: string): Promise<ConsumeMessage | false> {
    const q = this.queues.get(queue);
    const msg = q?.messages.shift();
    if (!msg) return Promise.resolve(false);
    this.inFlight.set(msg, queue);
    return Promise.resolve(msg as unknown as ConsumeMessage);
  }

  purgeQueue(queue: string): Promise<{ messageCount: number }> {
    const q = this.queues.get(queue);
    const messageCount = q?.messages.length ?? 0;
    if (q) q.messages = [];
    return Promise.resolve({ messageCount });
  }

  // --- helpers de teste ---

  asChannel(): Channel {
    return this as unknown as Channel;
  }

  /** Simula o broker entregando uma mensagem inicial a uma fila com consumer. */
  deliver(queue: string, body: Buffer | Envelope): void {
    const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    this.enqueue(queue, this.makeStored(content, { contentType: 'application/json' }, queue));
  }

  dlqMessages(): StoredMsg[] {
    return this.queues.get(DLQ_QUEUE)?.messages ?? [];
  }
}

function flush(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('flush timeout'));
      setTimeout(tick, 2);
    };
    tick();
  });
}

describe('topology — DLX/retry/DLQ', () => {
  it('declara a DLQ, a retry ladder e os bindings de re-entrada (idempotente)', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());
    await assertTopology(fake.asChannel()); // 2x → idempotente, sem throw

    expect(fake.queues.has(DLQ_QUEUE)).toBe(true);

    for (const source of [QUEUES.inbound, QUEUES.outbound, QUEUES.media]) {
      // bind de re-entrada: source ligado a hm.dlx pela rk = nome da fila.
      expect(
        fake.bindings.some((b) => b.queue === source && b.exchange === EXCHANGES.dlx && b.pattern === source),
      ).toBe(true);
      // uma wait-queue por nível de backoff, com TTL + DLX + DLRK corretos.
      for (const ttl of RETRY_BACKOFF_MS) {
        const wq = fake.queues.get(retryWaitQueueName(source, ttl));
        expect(wq).toBeDefined();
        expect(wq?.args['x-message-ttl']).toBe(ttl);
        expect(wq?.args['x-dead-letter-exchange']).toBe(EXCHANGES.dlx);
        expect(wq?.args['x-dead-letter-routing-key']).toBe(source);
      }
    }
  });
});

describe('consume — política de retry/DLQ', () => {
  it('erro transitório N vezes → é retentado e processa quando o handler para de falhar', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    let calls = 0;
    let succeeded = false;
    await consume(fake.asChannel(), QUEUES.inbound, async () => {
      calls += 1;
      if (calls < 3) throw new Error('DB indisponível (transitório)');
      succeeded = true;
    });

    fake.deliver(QUEUES.inbound, makeEnvelope('msg.inbound', WORKSPACE, { text: 'oi' }));
    await flush(() => succeeded);

    expect(calls).toBe(3); // 2 falhas + 1 sucesso
    expect(succeeded).toBe(true);
    expect(fake.dlqMessages()).toHaveLength(0); // não perdida, não foi pra DLQ
  });

  it('erro persistente além do limite → termina na DLQ (não descartado)', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    let calls = 0;
    await consume(fake.asChannel(), QUEUES.outbound, async () => {
      calls += 1;
      throw new Error('falha persistente');
    });

    fake.deliver(QUEUES.outbound, makeEnvelope('msg.outbound', WORKSPACE, { text: 'x' }));
    await flush(() => fake.dlqMessages().length > 0);

    const dlq = fake.dlqMessages();
    expect(dlq).toHaveLength(1);
    // tentativas = tamanho do backoff; +1 chamada que decidiu pela DLQ.
    expect(calls).toBe(RETRY_BACKOFF_MS.length + 1);
    const dead = dlq[0];
    expect(dead?.properties.headers[DLQ_REASON_HEADER]).toBe('max_retries_exhausted');
    expect(dead?.properties.headers[RETRY_COUNT_HEADER]).toBe(RETRY_BACKOFF_MS.length);
    expect(dead?.properties.headers[ORIGIN_QUEUE_HEADER]).toBe(QUEUES.outbound);
  });

  it('erro de conteúdo (NonRetryableError) → vai DIRETO pra DLQ, sem retries', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    let calls = 0;
    await consume(fake.asChannel(), QUEUES.media, async () => {
      calls += 1;
      throw new NonRetryableError('provider desconhecido');
    });

    fake.deliver(QUEUES.media, makeEnvelope('media.download', WORKSPACE, { url: 'x' }));
    await flush(() => fake.dlqMessages().length > 0);

    expect(calls).toBe(1); // sem N retries
    const dead = fake.dlqMessages()[0];
    expect(dead?.properties.headers[DLQ_REASON_HEADER]).toBe('non_retryable');
  });

  it('envelope inválido (Zod) → DLQ direto com motivo invalid_envelope, handler nunca chamado', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    let calls = 0;
    await consume(fake.asChannel(), QUEUES.inbound, async () => {
      calls += 1;
    });

    fake.deliver(QUEUES.inbound, Buffer.from(JSON.stringify({ not: 'an envelope' })));
    await flush(() => fake.dlqMessages().length > 0);

    expect(calls).toBe(0);
    expect(fake.dlqMessages()[0]?.properties.headers[DLQ_REASON_HEADER]).toBe('invalid_envelope');
  });

  it('fila NÃO confiável mantém o comportamento legado (nack sem requeue, sem DLQ)', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    await consume(fake.asChannel(), QUEUES.flows, async () => {
      throw new Error('falha numa fila legada');
    });

    fake.deliver(QUEUES.flows, makeEnvelope('flow.run', WORKSPACE, {}));
    await flush(() => fake.nacks.length > 0);

    expect(fake.nacks).toHaveLength(1);
    expect(fake.nacks[0]?.requeue).toBe(false);
    expect(fake.dlqMessages()).toHaveLength(0);
  });

  it('sucesso → ack, sem retry nem DLQ', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    await consume(fake.asChannel(), QUEUES.inbound, async () => undefined);
    fake.deliver(QUEUES.inbound, makeEnvelope('msg.inbound', WORKSPACE, {}));
    await flush(() => fake.acks.length > 0);

    expect(fake.acks).toHaveLength(1);
    expect(fake.dlqMessages()).toHaveLength(0);
  });
});

describe('dlq — inspeção e replay', () => {
  it('inspectDlq lê sem remover; replayDlq devolve à fila de origem', async () => {
    const fake = new FakeChannel();
    await assertTopology(fake.asChannel());

    // Gera 1 mensagem na DLQ por erro persistente.
    await consume(fake.asChannel(), QUEUES.outbound, async () => {
      throw new Error('persistente');
    });
    fake.deliver(QUEUES.outbound, makeEnvelope('msg.outbound', WORKSPACE, { id: 1 }));
    await flush(() => fake.dlqMessages().length > 0);

    const records = await inspectDlq(fake.asChannel(), { max: 10 });
    expect(records).toHaveLength(1);
    expect(records[0]?.originQueue).toBe(QUEUES.outbound);
    expect(records[0]?.reason).toBe('max_retries_exhausted');
    // inspeção não-destrutiva: continua na DLQ.
    expect(fake.dlqMessages()).toHaveLength(1);

    const moved = await replayDlq(fake.asChannel(), { max: 10 });
    expect(moved).toBe(1);
    expect(fake.dlqMessages()).toHaveLength(0); // saiu da DLQ
  });
});

// --- Integração opcional contra RabbitMQ real (MQ_IT=1) ---
const RUN_IT = process.env['MQ_IT'] === '1';
describe.skipIf(!RUN_IT)('integração — broker real', () => {
  it('retry com TTL real reentrega e DLQ recebe após esgotar', async () => {
    const { connectMq } = await import('./connection');
    const url = process.env['AMQP_URL'] ?? 'amqp://hm:hm@localhost:5672';
    const { connection, channel } = await connectMq(url);
    const testQueue = `hm.q.it.${Date.now()}`;
    const backoff = [200] as const;
    try {
      await channel.assertExchange(EXCHANGES.dlx, 'topic', { durable: true });
      await channel.assertQueue(testQueue, { durable: false, autoDelete: true });
      await assertRetryTopology(channel, testQueue, backoff);
      await assertDlq(channel);

      let calls = 0;
      await consume(channel, testQueue, async () => {
        calls += 1;
        throw new Error('sempre falha');
      }, { retry: { backoffMs: backoff } });

      await channel.purgeQueue(DLQ_QUEUE);
      channel.sendToQueue(testQueue, Buffer.from(JSON.stringify(makeEnvelope('it', WORKSPACE, {}))), {
        persistent: true,
        contentType: 'application/json',
      });

      await new Promise((r) => setTimeout(r, 1500));
      const records = await inspectDlq(channel, { max: 5 });
      expect(calls).toBeGreaterThanOrEqual(2); // pelo menos 1 retry
      expect(records.some((r) => r.originQueue === testQueue)).toBe(true);
    } finally {
      await channel.deleteQueue(testQueue).catch(() => undefined);
      for (const ttl of backoff) {
        await channel.deleteQueue(retryWaitQueueName(testQueue, ttl)).catch(() => undefined);
      }
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
    }
  });
});
