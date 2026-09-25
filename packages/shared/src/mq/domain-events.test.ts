/**
 * F70-S09 — contrato dos eventos de domínio: catálogo, routing, schema estrito
 * (nada fora do contrato sai), eventId canônico e emissor que nunca lança.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDomainEnvelope,
  CONVERSATION_OPENED_TRIGGERS,
  DOMAIN_EVENTS,
  domainEventRoutingKey,
  domainEvents,
  emitDomainEvent,
  parseDomainEnvelope,
  setDomainEventLogger,
  setDomainEventTransport,
  type DomainEventDraft,
} from './domain-events';
import { makeEnvelope, type Envelope } from './envelope';
import { NonRetryableError, isReliableQueue } from './retry';
import { DOMAIN_EVENT_BINDING, QUEUES } from './topology';

const ws = randomUUID();

afterEach(() => {
  setDomainEventTransport(null);
  setDomainEventLogger(null);
});

describe('catálogo e routing', () => {
  it('inclui o evento novo de handoff e os já documentados', () => {
    expect(DOMAIN_EVENTS).toContain('conversation.handoff');
    expect(DOMAIN_EVENTS).toContain('message.received');
    expect(DOMAIN_EVENTS).toContain('conversion.registered');
  });

  it('routing key domain.<evento> casa o bind da fila de webhooks', () => {
    expect(domainEventRoutingKey('deal.won')).toBe('domain.deal.won');
    expect(DOMAIN_EVENT_BINDING).toBe('domain.#');
  });

  it('a fila de webhooks é confiável (retry + DLQ)', () => {
    expect(isReliableQueue(QUEUES.webhooks)).toBe(true);
  });
});

describe('contrato estrito', () => {
  it('campo fora do contrato não sai (anti-vazamento de PII)', () => {
    const draft = domainEvents.conversationHandoff(ws, {
      conversationId: randomUUID(),
      agentId: randomUUID(),
      departmentId: null,
    });
    const leaky = { ...draft, data: { ...draft.data, reason: 'cliente João, CPF 123' } };
    expect(() => buildDomainEnvelope(leaky as DomainEventDraft)).toThrow();
  });

  it('envelope ida e volta preserva eventId, occurredAt e data', () => {
    const messageId = randomUUID();
    const draft = domainEvents.messageReceived(ws, {
      conversationId: randomUUID(),
      messageId,
      contactId: null,
      channelId: randomUUID(),
      type: 'text',
      text: 'oi',
    });
    const env = buildDomainEnvelope(draft);
    expect(env.type).toBe('message.received');
    const parsed = parseDomainEnvelope(env);
    expect(parsed.eventId).toBe(`${messageId}:received`);
    expect(parsed.workspaceId).toBe(ws);
    expect(parsed.data['text']).toBe('oi');
  });

  it('evento desconhecido e payload inválido são erro de conteúdo (DLQ direto)', () => {
    expect(() => parseDomainEnvelope(makeEnvelope('deal.exploded', ws, {}))).toThrow(
      NonRetryableError,
    );
    expect(() =>
      parseDomainEnvelope(makeEnvelope('deal.won', ws, { eventId: '', data: {} })),
    ).toThrow(NonRetryableError);
  });
});

describe('eventId canônico', () => {
  it('fechamento de deal: mesma data = mesmo id; ganho e perda distintos', () => {
    const closedAt = new Date('2026-09-25T12:00:00.000Z');
    const data = {
      dealId: randomUUID(),
      pipelineId: randomUUID(),
      stageId: randomUUID(),
      contactId: randomUUID(),
      valueCents: 1000,
      currency: 'BRL',
    };
    const a = domainEvents.dealClosed(ws, true, closedAt, data);
    const b = domainEvents.dealClosed(ws, true, closedAt, data);
    const lost = domainEvents.dealClosed(ws, false, closedAt, data);
    expect(a.eventId).toBe(b.eventId);
    expect(a.event).toBe('deal.won');
    expect(lost.event).toBe('deal.lost');
    expect(lost.eventId).not.toBe(a.eventId);
    expect(a.occurredAt).toBe(closedAt.toISOString());
  });

  it('conversa: criação pelo inbound é única; reabertura é por ocorrência', () => {
    const conversationId = randomUUID();
    const base = { conversationId, contactId: null, channelId: null } as const;
    const opened = domainEvents.conversationOpened(ws, { ...base, trigger: 'inbound' });
    expect(opened.eventId).toBe(`${conversationId}:opened`);
    const r1 = domainEvents.conversationOpened(ws, { ...base, trigger: 'reopened' });
    const r2 = domainEvents.conversationOpened(ws, { ...base, trigger: 'reopened' });
    expect(r1.eventId).not.toBe(r2.eventId);
  });
});

describe('conversation.opened — origem (F70-S14)', () => {
  const base = () => ({ conversationId: randomUUID(), contactId: null, channelId: randomUUID() });

  it('catálogo de origens é exatamente o documentado', () => {
    expect([...CONVERSATION_OPENED_TRIGGERS]).toEqual([
      'inbound',
      'lead_ad',
      'app_echo',
      'history',
      'campaign',
      'reopened',
    ]);
  });

  it.each(['inbound', 'lead_ad', 'app_echo', 'history', 'campaign'] as const)(
    'criação por %s: aceita no contrato e eventId <conversa>:opened (o mesmo de qualquer origem)',
    (trigger) => {
      const data = { ...base(), trigger };
      const draft = domainEvents.conversationOpened(ws, data);
      expect(draft.eventId).toBe(`${data.conversationId}:opened`);
      const parsed = parseDomainEnvelope(buildDomainEnvelope(draft));
      expect(parsed.data['trigger']).toBe(trigger);
      expect(parsed.eventId).toBe(`${data.conversationId}:opened`);
    },
  );

  it('reabertura continua por ocorrência (não colide com a criação)', () => {
    const data = { ...base(), trigger: 'reopened' as const };
    const draft = domainEvents.conversationOpened(ws, data, 'occ-1');
    expect(draft.eventId).toBe(`${data.conversationId}:reopened:occ-1`);
    expect(() => buildDomainEnvelope(draft)).not.toThrow();
  });

  it('origem fora do catálogo é rejeitada na publicação', () => {
    const draft = domainEvents.conversationOpened(ws, { ...base(), trigger: 'inbound' });
    const forged = { ...draft, data: { ...draft.data, trigger: 'outbound' } };
    expect(() => buildDomainEnvelope(forged as unknown as DomainEventDraft)).toThrow();
    const semOrigem = { ...draft, data: { ...draft.data, trigger: undefined } };
    expect(() => buildDomainEnvelope(semOrigem as unknown as DomainEventDraft)).toThrow();
  });

  it('emitDomainEvent não publica origem inválida (devolve false, nunca lança)', async () => {
    const sent: string[] = [];
    setDomainEventTransport(async (rk) => {
      sent.push(rk);
    });
    setDomainEventLogger({ error: () => undefined, warn: () => undefined });
    const draft = domainEvents.conversationOpened(ws, { ...base(), trigger: 'campaign' });
    const forged = { ...draft, data: { ...draft.data, trigger: 'webhook' } };
    expect(await emitDomainEvent(forged as unknown as DomainEventDraft)).toBe(false);
    expect(await emitDomainEvent(draft)).toBe(true);
    expect(sent).toEqual(['domain.conversation.opened']);
  });
});

describe('emitDomainEvent', () => {
  it('publica na routing key do evento pelo transporte', async () => {
    const sent: Array<{ rk: string; env: Envelope }> = [];
    setDomainEventTransport(async (rk, env) => {
      sent.push({ rk, env });
    });
    const ok = await emitDomainEvent(
      domainEvents.dealCreated(ws, {
        dealId: randomUUID(),
        pipelineId: randomUUID(),
        stageId: randomUUID(),
        contactId: randomUUID(),
        conversationId: null,
        valueCents: 0,
        currency: 'BRL',
      }),
    );
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.rk).toBe('domain.deal.created');
  });

  it('nunca lança: falha do transporte vira false + log', async () => {
    const errors: string[] = [];
    setDomainEventLogger({ warn: () => undefined, error: (msg) => errors.push(msg) });
    setDomainEventTransport(async () => {
      throw new Error('broker fora');
    });
    const ok = await emitDomainEvent(
      domainEvents.conversationResolved(ws, {
        conversationId: randomUUID(),
        resolvedBy: 'agent',
        memberId: null,
        agentId: randomUUID(),
      }),
    );
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
