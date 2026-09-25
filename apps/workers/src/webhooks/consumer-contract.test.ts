/**
 * F70-S19 (achado L7) — o consumer de `hm.q.webhooks` revalida o `data` com o contrato
 * estrito do evento. Fora do contrato: nenhum fan-out, log do que falhou (sem o valor)
 * e erro não retentável, que o `consume` manda direto à DLQ. Sem banco nem broker (o
 * caminho real até a DLQ está no `e2e.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDomainEnvelope,
  defaultPolicyForQueue,
  DLQ_REASON_HEADER,
  DLQ_ROUTING_KEY,
  DomainEventContractError,
  domainEvents,
  EXCHANGES,
  handleConsumeFailure,
  makeEnvelope,
  NonRetryableError,
  QUEUES,
  type FailureContext,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { handleDomainEventEnvelope } from './consumer';

const ws = randomUUID();

function deps() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const fanout = vi.fn(async () => ({ matchedWebhooks: 1, created: 1, deduped: 0 }));
  return { logger, fanout, handlerDeps: { logger: logger as unknown as Logger, fanout } };
}

describe('consumer de eventos de domínio — contrato estrito (F70-S19)', () => {
  it('payload fora do contrato: sem fan-out, warn sem o valor, erro não retentável (DLQ)', async () => {
    const { logger, fanout, handlerDeps } = deps();
    const envelope = makeEnvelope('conversation.handoff', ws, {
      eventId: `${randomUUID()}:handoff:x`,
      occurredAt: new Date().toISOString(),
      data: {
        conversationId: randomUUID(),
        agentId: randomUUID(),
        departmentId: null,
        reason: 'cliente Maria, CPF 123.456.789-00',
      },
    });

    let error: unknown;
    try {
      await handleDomainEventEnvelope(envelope, handlerDeps);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(DomainEventContractError);
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(fanout).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    const [logMsg, fields] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(logMsg).toContain('fora do contrato');
    expect(fields).toMatchObject({
      envelopeId: envelope.id,
      type: 'conversation.handoff',
      part: 'data',
      issues: [{ path: '(raiz)', code: 'unrecognized_keys', keys: ['reason'] }],
    });
    expect(JSON.stringify(fields)).not.toContain('CPF');

    // O que o `consume` faz com esse erro: DLQ direto, sem wait-queue de retry.
    const channel = { publish: vi.fn(), sendToQueue: vi.fn(), ack: vi.fn() };
    const msg = {
      content: Buffer.from(JSON.stringify(envelope)),
      properties: { headers: {}, contentType: 'application/json' },
      fields: {},
    };
    const policy = defaultPolicyForQueue(QUEUES.webhooks);
    if (policy === null) throw new Error('hm.q.webhooks deveria ser confiável');
    handleConsumeFailure({
      channel,
      queue: QUEUES.webhooks,
      msg,
      error,
      policy,
    } as unknown as FailureContext);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
    expect(channel.publish).toHaveBeenCalledOnce();
    const [exchange, routingKey, , options] = channel.publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ];
    expect(exchange).toBe(EXCHANGES.dlx);
    expect(routingKey).toBe(DLQ_ROUTING_KEY);
    expect(options.headers[DLQ_REASON_HEADER]).toBe('non_retryable');
    expect(channel.ack).toHaveBeenCalledOnce();
  });

  it('evento fora do catálogo também vai à DLQ com log', async () => {
    const { logger, fanout, handlerDeps } = deps();
    await expect(
      handleDomainEventEnvelope(makeEnvelope('deal.exploded', ws, {}), handlerDeps),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect(fanout).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('evento dentro do contrato segue para o fan-out', async () => {
    const { logger, fanout, handlerDeps } = deps();
    const draft = domainEvents.conversationHandoff(ws, {
      conversationId: randomUUID(),
      agentId: randomUUID(),
      departmentId: null,
    });
    await handleDomainEventEnvelope(buildDomainEnvelope(draft), handlerDeps);
    expect(fanout).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
