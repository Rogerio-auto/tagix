/**
 * F70-S09 — contrato dos eventos de domínio: catálogo, routing, schema estrito
 * (nada fora do contrato sai) e eventId canônico. A publicação é só pela outbox
 * (F70-S20): `outbox.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDomainEnvelope,
  DOMAIN_EVENT_TEXT_MAX_LENGTH,
  DOMAIN_EVENT_TEXT_TRUNCATION_MARK,
  DomainEventContractError,
  truncateEventText,
  CONVERSATION_OPENED_TRIGGERS,
  DOMAIN_EVENTS,
  domainEventRoutingKey,
  domainEvents,
  parseDomainEnvelope,
  setDomainEventLogger,
  type DomainEventDraft,
} from './domain-events';
import { domainEventsOutbox } from './outbox';
import { makeEnvelope, type Envelope } from './envelope';
import { NonRetryableError, isReliableQueue } from './retry';
import { DOMAIN_EVENT_BINDING, QUEUES } from './topology';

const ws = randomUUID();

afterEach(() => {
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
      'calendar_reminder',
      'reopened',
    ]);
  });

  it.each(['inbound', 'lead_ad', 'app_echo', 'history', 'campaign', 'calendar_reminder'] as const)(
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

  it('origem inválida não vira linha da outbox (logada e descartada, nunca lança)', () => {
    const errors: string[] = [];
    setDomainEventLogger({ error: (msg) => errors.push(msg), warn: () => undefined });
    const draft = domainEvents.conversationOpened(ws, { ...base(), trigger: 'campaign' });
    const forged = { ...draft, data: { ...draft.data, trigger: 'webhook' } };
    const out = domainEventsOutbox([forged as unknown as DomainEventDraft, draft]);
    expect(out.map((m) => m.routingKey)).toEqual(['domain.conversation.opened']);
    expect(out[0]?.eventId).toBe(draft.eventId);
    expect(errors).toHaveLength(1);
  });
});

describe('teto do texto livre (F70-S19, L6)', () => {
  const base = () => ({
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: null,
    channelId: randomUUID(),
    type: 'text',
  });

  it('texto dentro do teto passa igual (inclusive no limite exato e null)', () => {
    const exact = 'a'.repeat(DOMAIN_EVENT_TEXT_MAX_LENGTH);
    expect(truncateEventText(exact)).toBe(exact);
    expect(truncateEventText(null)).toBeNull();
    expect(truncateEventText('')).toBe('');
  });

  it('message.received e message.sent truncam no construtor, com a marca de corte', () => {
    const huge = 'x'.repeat(60_000);
    const received = domainEvents.messageReceived(ws, { ...base(), text: huge });
    const sent = domainEvents.messageSent(ws, {
      conversationId: randomUUID(),
      messageId: randomUUID(),
      type: 'text',
      text: huge,
    });
    for (const draft of [received, sent]) {
      const text = (draft.data as { text: string }).text;
      expect(text).toHaveLength(DOMAIN_EVENT_TEXT_MAX_LENGTH);
      expect(text.endsWith(DOMAIN_EVENT_TEXT_TRUNCATION_MARK)).toBe(true);
      // O contrato aceita o texto truncado na publicação e no consumo.
      expect(parseDomainEnvelope(buildDomainEnvelope(draft)).data['text']).toBe(text);
    }
  });

  it('não parte um emoji (par substituto) no corte', () => {
    // O corte cai exatamente entre as metades do par: o par inteiro sai.
    const cut = DOMAIN_EVENT_TEXT_MAX_LENGTH - DOMAIN_EVENT_TEXT_TRUNCATION_MARK.length;
    const text = 'a'.repeat(cut - 1) + '😀'.repeat(10);
    const out = truncateEventText(text)!;
    expect(out.length).toBeLessThanOrEqual(DOMAIN_EVENT_TEXT_MAX_LENGTH);
    // Sem metade alta solta antes da marca.
    expect(out).toBe('a'.repeat(cut - 1) + DOMAIN_EVENT_TEXT_TRUNCATION_MARK);
  });

  it('o contrato recusa texto acima do teto que não passou pelo construtor', () => {
    const draft = domainEvents.messageReceived(ws, { ...base(), text: 'oi' });
    const bypass = { ...draft, data: { ...draft.data, text: 'y'.repeat(DOMAIN_EVENT_TEXT_MAX_LENGTH + 1) } };
    expect(() => buildDomainEnvelope(bypass as DomainEventDraft)).toThrow();
  });
});

describe('contrato estrito no consumo (F70-S19, L7)', () => {
  function forged(data: Record<string, unknown>): Envelope {
    return makeEnvelope('message.received', ws, {
      eventId: `${randomUUID()}:received`,
      occurredAt: new Date().toISOString(),
      data,
    });
  }
  const valid = () => ({
    conversationId: randomUUID(),
    messageId: randomUUID(),
    contactId: null,
    channelId: randomUUID(),
    type: 'text',
    text: 'oi',
  });

  it('campo a mais é recusado com erro não retentável, sem o valor no erro', () => {
    let error: unknown;
    try {
      parseDomainEnvelope(forged({ ...valid(), phone: '+5511999999999' }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DomainEventContractError);
    expect(error).toBeInstanceOf(NonRetryableError);
    const contract = error as DomainEventContractError;
    expect(contract.part).toBe('data');
    expect(contract.issues).toEqual([{ path: '(raiz)', code: 'unrecognized_keys', keys: ['phone'] }]);
    expect(JSON.stringify(contract.issues)).not.toContain('5511999999999');
    expect(contract.message).not.toContain('5511999999999');
  });

  it('tipo errado, campo faltando e texto acima do teto são recusados', () => {
    const missing: Record<string, unknown> = valid();
    delete missing['messageId'];
    for (const data of [
      { ...valid(), conversationId: 'não-é-uuid' },
      missing,
      { ...valid(), text: 'z'.repeat(DOMAIN_EVENT_TEXT_MAX_LENGTH + 1) },
    ]) {
      expect(() => parseDomainEnvelope(forged(data))).toThrow(DomainEventContractError);
    }
  });

  it('dado dentro do contrato passa', () => {
    const data = valid();
    expect(parseDomainEnvelope(forged(data)).data).toEqual(data);
  });
});
