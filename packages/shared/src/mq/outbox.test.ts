/**
 * F70-S16 — construtores das mensagens da outbox (sem banco nem broker).
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { domainEvents, setDomainEventLogger } from './domain-events';
import { makeEnvelope } from './envelope';
import { domainEventOutbox, domainEventsOutbox, queueJobOutbox } from './outbox';
import { EXCHANGES, QUEUES } from './topology';

const ws = randomUUID();

afterEach(() => setDomainEventLogger(null));

describe('domainEventOutbox', () => {
  it('evento → hm.events, rk domain.<evento>, eventId canônico e envelope válido', () => {
    const conversationId = randomUUID();
    const draft = domainEvents.conversationOpened(ws, {
      conversationId,
      contactId: null,
      channelId: null,
      trigger: 'lead_ad',
    });
    const msg = domainEventOutbox(draft);
    expect(msg).toMatchObject({
      kind: 'event',
      eventId: `${conversationId}:opened`,
      exchange: EXCHANGES.events,
      routingKey: 'domain.conversation.opened',
    });
    expect(msg.envelope).toMatchObject({
      type: 'conversation.opened',
      workspaceId: ws,
      payload: { eventId: `${conversationId}:opened`, data: { trigger: 'lead_ad' } },
    });
  });
});

describe('domainEventsOutbox', () => {
  it('evento fora do contrato é logado e descartado; os outros seguem, na ordem', () => {
    const error = vi.fn();
    setDomainEventLogger({ warn: vi.fn(), error });
    const ok1 = domainEvents.dealCreated(ws, {
      dealId: randomUUID(),
      pipelineId: randomUUID(),
      stageId: randomUUID(),
      contactId: randomUUID(),
      conversationId: null,
      valueCents: 0,
      currency: 'BRL',
    });
    const ruim = domainEvents.messageSent(ws, {
      conversationId: 'nao-e-uuid',
      messageId: randomUUID(),
      type: 'text',
      text: null,
    });
    const ok2 = domainEvents.messageSent(ws, {
      conversationId: randomUUID(),
      messageId: randomUUID(),
      type: 'text',
      text: 'oi',
    });

    const msgs = domainEventsOutbox([ok1, ruim, ok2]);
    expect(msgs.map((m) => m.eventId)).toEqual([ok1.eventId, ok2.eventId]);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[1]).toMatchObject({ eventId: ruim.eventId });
  });

  it('workspace inválido não vira linha (o consumidor recusaria o envelope)', () => {
    setDomainEventLogger({ warn: vi.fn(), error: vi.fn() });
    const draft = domainEvents.messageSent('ws1', {
      conversationId: randomUUID(),
      messageId: randomUUID(),
      type: 'text',
      text: null,
    });
    expect(domainEventsOutbox([draft])).toEqual([]);
  });
});

describe('queueJobOutbox', () => {
  it('job → exchange padrão com a fila como routing key; eventId = id do envelope', () => {
    const env = makeEnvelope('outbound.request', ws, { kind: 'text' });
    expect(queueJobOutbox(QUEUES.outbound, env)).toEqual({
      kind: 'job',
      eventId: env.id,
      exchange: '',
      routingKey: QUEUES.outbound,
      envelope: env,
    });
  });

  it('envelope inválido lança (defeito do produtor, dentro da transação)', () => {
    const env = { ...makeEnvelope('outbound.request', ws, {}), workspaceId: 'x' };
    expect(() => queueJobOutbox(QUEUES.outbound, env)).toThrow();
  });
});
