/**
 * F70-S25 — construtores dos jobs que passaram a ir pela outbox: gatilho do agente de IA
 * (`hm.q.flows`) e passo de flow (`hm.q.flow.execution`). Sem banco nem broker.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_REQUESTED_TYPE,
  AGENT_RUN_TRIGGER_ID_MAX,
  agentRunJobOutbox,
  agentRunRequestedPayloadSchema,
  agentRunTriggerId,
  resolveAgentRunTriggerId,
} from './agent-run';
import { FLOW_EXECUTION_STEP_TYPE, flowExecutionStepOutbox, parseFlowExecutionStep } from './flows';
import { OUTBOX_JOB_QUEUES } from './outbox';
import { QUEUES } from './topology';

const ws = randomUUID();
const trigger = () => ({
  conversationId: randomUUID(),
  contactId: randomUUID(),
  channelId: randomUUID(),
  provider: 'meta_whatsapp' as const,
});

describe('OUTBOX_JOB_QUEUES', () => {
  it('aceita as filas dos novos produtores transacionais', () => {
    expect(OUTBOX_JOB_QUEUES).toEqual(
      expect.arrayContaining([QUEUES.flows, QUEUES.flowExecution, QUEUES.campaigns]),
    );
  });
});

describe('agentRunJobOutbox', () => {
  it('gatilho → exchange padrão em hm.q.flows, tipo flow.run.requested, payload do contrato', () => {
    const payload = { ...trigger(), triggerExternalId: 'wamid.1' };
    const msg = agentRunJobOutbox(ws, payload);
    expect(msg).toMatchObject({
      kind: 'job',
      exchange: '',
      routingKey: QUEUES.flows,
      eventId: msg.envelope.id,
    });
    expect(msg.envelope).toMatchObject({
      type: AGENT_RUN_REQUESTED_TYPE,
      workspaceId: ws,
      // F70-S26: o inbound sem triggerId explícito ganha o id derivado da mensagem.
      payload: {
        ...payload,
        triggerId: agentRunTriggerId.inbound(payload.conversationId, 'wamid.1'),
      },
    });
  });

  it('gatilho proativo (sem triggerExternalId) é aceito com o id do fato', () => {
    const payload = { ...trigger(), triggerId: agentRunTriggerId.followup(randomUUID(), 1) };
    expect(agentRunJobOutbox(ws, payload).envelope.payload).toEqual(payload);
  });

  it('gatilho sem triggerId nem triggerExternalId lança (nada identifica o turno)', () => {
    expect(() => agentRunJobOutbox(ws, trigger())).toThrow(/triggerId/);
  });

  it('cada gravação é um evento novo; o id do gatilho é o mesmo (F70-S26)', () => {
    const payload = { ...trigger(), triggerId: agentRunTriggerId.reengagement(randomUUID(), 7) };
    const a = agentRunJobOutbox(ws, payload);
    const b = agentRunJobOutbox(ws, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.envelope.payload).toEqual(b.envelope.payload);
  });

  it('payload fora do contrato lança (defeito do produtor derruba a transação)', () => {
    const base = { ...trigger(), triggerId: 'followup:x:1' };
    expect(() => agentRunJobOutbox(ws, { ...base, conversationId: 'nao-uuid' })).toThrow();
    expect(() =>
      agentRunJobOutbox(ws, { ...base, provider: 'telegram' as unknown as 'waha' }),
    ).toThrow();
    expect(() =>
      agentRunJobOutbox(ws, { ...base, triggerId: 'x'.repeat(AGENT_RUN_TRIGGER_ID_MAX + 1) }),
    ).toThrow();
    // Campo estranho não passa em silêncio (contrato estrito).
    expect(
      agentRunRequestedPayloadSchema.safeParse({ ...trigger(), agentId: randomUUID() }).success,
    ).toBe(false);
  });
});

describe('agentRunTriggerId / resolveAgentRunTriggerId (F70-S26)', () => {
  const conv = randomUUID();
  const other = randomUUID();

  it('mesmo fato → mesmo id; fatos diferentes → ids diferentes', () => {
    expect(agentRunTriggerId.inbound(conv, 'wamid.A')).toBe(
      agentRunTriggerId.inbound(conv, 'wamid.A'),
    );
    const ids = [
      agentRunTriggerId.inbound(conv, 'wamid.A'),
      agentRunTriggerId.inbound(conv, 'wamid.B'),
      agentRunTriggerId.inbound(other, 'wamid.A'),
      agentRunTriggerId.reengagement(conv, 100),
      agentRunTriggerId.reengagement(conv, 101),
      agentRunTriggerId.followup(conv, 100),
      agentRunTriggerId.agentSwitch(conv, '1790000000000001'),
      agentRunTriggerId.agentSwitch(conv, '1790000000000002'),
      agentRunTriggerId.transfer(conv, other),
      agentRunTriggerId.transfer(conv, randomUUID()),
      agentRunTriggerId.event(randomUUID()),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id de provider longo vira hash estável dentro do teto', () => {
    const long = 'x'.repeat(500);
    const id = agentRunTriggerId.inbound(conv, long);
    expect(id).toMatch(/^inbound:sha256:[0-9a-f]{64}$/);
    expect(id).toBe(agentRunTriggerId.inbound(conv, long));
    expect(id).not.toBe(agentRunTriggerId.inbound(conv, `${long}y`));
    expect(id.length).toBeLessThanOrEqual(AGENT_RUN_TRIGGER_ID_MAX);
  });

  it('consumidor: triggerId do envelope; senão inbound derivado; senão id do envelope', () => {
    const envelopeId = randomUUID();
    expect(
      resolveAgentRunTriggerId({ conversationId: conv, triggerId: 'followup:c:1' }, envelopeId),
    ).toBe('followup:c:1');
    // Envelope antigo do inbound: colide com o novo do mesmo fato.
    const fresh = agentRunJobOutbox(ws, {
      ...trigger(),
      conversationId: conv,
      triggerExternalId: 'wamid.Z',
    });
    expect(
      resolveAgentRunTriggerId({ conversationId: conv, triggerExternalId: 'wamid.Z' }, envelopeId),
    ).toBe((fresh.envelope.payload as { triggerId: string }).triggerId);
    // Envelope antigo proativo: o id do envelope (estável na republicação da mesma linha).
    expect(resolveAgentRunTriggerId({ conversationId: conv }, envelopeId)).toBe(
      agentRunTriggerId.event(envelopeId),
    );
  });
});

describe('flowExecutionStepOutbox', () => {
  it('passo → exchange padrão em hm.q.flow.execution; o consumer lê o mesmo payload', () => {
    const executionId = randomUUID();
    const msg = flowExecutionStepOutbox(ws, executionId);
    expect(msg).toMatchObject({
      kind: 'job',
      exchange: '',
      routingKey: QUEUES.flowExecution,
      eventId: msg.envelope.id,
    });
    expect(msg.envelope.type).toBe(FLOW_EXECUTION_STEP_TYPE);
    expect(parseFlowExecutionStep(msg.envelope.payload)).toEqual({ workspaceId: ws, executionId });
  });

  it('id inválido lança', () => {
    expect(() => flowExecutionStepOutbox(ws, 'x')).toThrow();
  });
});
