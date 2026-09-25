/**
 * F70-S25 — construtores dos jobs que passaram a ir pela outbox: gatilho do agente de IA
 * (`hm.q.flows`) e passo de flow (`hm.q.flow.execution`). Sem banco nem broker.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_REQUESTED_TYPE,
  agentRunJobOutbox,
  agentRunRequestedPayloadSchema,
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
      payload,
    });
  });

  it('gatilho proativo (sem triggerExternalId) é aceito', () => {
    const payload = trigger();
    expect(agentRunJobOutbox(ws, payload).envelope.payload).toEqual(payload);
  });

  it('cada gravação é um evento novo (a retentativa do produtor não colide com a anterior)', () => {
    const payload = trigger();
    expect(agentRunJobOutbox(ws, payload).eventId).not.toBe(agentRunJobOutbox(ws, payload).eventId);
  });

  it('payload fora do contrato lança (defeito do produtor derruba a transação)', () => {
    expect(() => agentRunJobOutbox(ws, { ...trigger(), conversationId: 'nao-uuid' })).toThrow();
    expect(() =>
      agentRunJobOutbox(ws, { ...trigger(), provider: 'telegram' as unknown as 'waha' }),
    ).toThrow();
    // Campo estranho não passa em silêncio (contrato estrito).
    expect(
      agentRunRequestedPayloadSchema.safeParse({ ...trigger(), agentId: randomUUID() }).success,
    ).toBe(false);
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
