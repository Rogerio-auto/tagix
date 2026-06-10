import { describe, expect, it, vi } from 'vitest';
import type { FlowExecutionContext, FlowNode } from '../types';
import { messageHandler } from './message.handler';
import { waitHandler } from './wait.handler';
import { waitForResponseHandler } from './wait_for_response.handler';
import { conditionHandler } from './condition.handler';
import { switchHandler } from './switch.handler';
import { aiActionHandler } from './ai_action.handler';
import { changeStatusHandler } from './change_status.handler';
import { httpRequestHandler } from './http_request.handler';
import { externalNotifyHandler } from './external_notify.handler';
import { addTagHandler } from './add_tag.handler';

function makeCtx(over: Partial<FlowExecutionContext> = {}): FlowExecutionContext {
  return {
    workspaceId: 'ws',
    executionId: 'ex',
    flowId: 'f',
    conversationId: 'c1',
    contactId: 'ct1',
    variables: {},
    sendMessage: vi.fn(async () => {}),
    sendPresence: vi.fn(async () => {}),
    setConversationAi: vi.fn(async () => {}),
    setConversationStatus: vi.fn(async () => {}),
    httpRequest: vi.fn(async () => ({ status: 200, ok: true, body: { ok: 1 }, headers: {} })),
    log: vi.fn(),
    now: () => new Date('2026-06-10T00:00:00.000Z'),
    ...over,
  };
}
const node = (data: unknown): FlowNode<never> => ({ id: 'n', type: 'x', data: data as never });

describe('message handler', () => {
  it('interpola texto e publica outbound', async () => {
    const ctx = makeCtx({ variables: { contact: { name: 'Ana' } } });
    const r = await messageHandler.execute(node({ text: 'Ola {{contact.name}}' }), ctx);
    expect(r.status).toBe('SUCCESS');
    expect(ctx.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Ola Ana', conversationId: 'c1' }),
    );
  });
  it('preAction dispara presenca', async () => {
    const ctx = makeCtx();
    await messageHandler.execute(node({ text: 'oi', preAction: 'typing' }), ctx);
    expect(ctx.sendPresence).toHaveBeenCalledOnce();
  });
});

describe('wait handler', () => {
  it('retorna WAITING com nextStepAt correto', async () => {
    const ctx = makeCtx();
    const r = await waitHandler.execute(node({ minutes: 5 }), ctx);
    expect(r.status).toBe('WAITING');
    if (r.status === 'WAITING') expect(r.nextStepAt).toBe('2026-06-10T00:05:00.000Z');
  });
});

describe('wait_for_response (biestavel)', () => {
  it('1a chamada -> WAITING + markers', async () => {
    const ctx = makeCtx();
    const r = await waitForResponseHandler.execute(
      node({ text: 'responda', timeoutMinutes: 10 }),
      ctx,
    );
    expect(r.status).toBe('WAITING');
    if (r.status === 'WAITING') expect(r.variables?.['waiting_for_response']).toBe(true);
  });
  it('resumption -> SUCCESS edge response', async () => {
    const ctx = makeCtx({ variables: { responded: true, response_edge: 'response' } });
    const r = await waitForResponseHandler.execute(node({}), ctx);
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'response' });
  });
  it('timeout -> SUCCESS edge timeout', async () => {
    const ctx = makeCtx({ variables: { waiting_for_response: true } });
    const r = await waitForResponseHandler.execute(node({}), ctx);
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'timeout' });
  });
});

describe('condition handler', () => {
  it('MSG_CONTAINS verdadeiro -> edge true', async () => {
    const ctx = makeCtx({ variables: { trigger: { message: 'quero COMPRAR agora' } } });
    const r = await conditionHandler.execute(
      node({ operator: 'MSG_CONTAINS', variable: 'trigger.message', value: 'comprar' }),
      ctx,
    );
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'true' });
  });
  it('HAS_TAG sem contactId avalia false (sem tocar DB)', async () => {
    const ctx = makeCtx({ contactId: null });
    const r = await conditionHandler.execute(
      node({ operator: 'HAS_TAG', tagId: '00000000-0000-0000-0000-0000000000aa' }),
      ctx,
    );
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'false' });
  });
  it('IN_STAGE sem contactId avalia false (sem tocar DB)', async () => {
    const ctx = makeCtx({ contactId: null });
    const r = await conditionHandler.execute(
      node({ operator: 'IN_STAGE', stageId: '00000000-0000-0000-0000-0000000000bb' }),
      ctx,
    );
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'false' });
  });
});

describe('switch handler', () => {
  it('roteia por case e cai no default', async () => {
    const ctx = makeCtx({ variables: { plano: 'gold' } });
    const hit = await switchHandler.execute(
      node({ variable: 'plano', cases: ['gold', 'silver'] }),
      ctx,
    );
    expect(hit).toMatchObject({ edgeHandle: 'gold' });
    const miss = await switchHandler.execute(node({ variable: 'plano', cases: ['bronze'] }), ctx);
    expect(miss).toMatchObject({ edgeHandle: 'default' });
  });
});

describe('ai_action / change_status', () => {
  it('ACTIVATE seta ai_mode on + agent', async () => {
    const ctx = makeCtx();
    await aiActionHandler.execute(
      node({ action: 'ACTIVATE', agentId: '00000000-0000-0000-0000-000000000001' }),
      ctx,
    );
    expect(ctx.setConversationAi).toHaveBeenCalledWith(expect.objectContaining({ aiMode: 'on' }));
  });
  it('change_status atualiza status', async () => {
    const ctx = makeCtx();
    await changeStatusHandler.execute(node({ status: 'resolved' }), ctx);
    expect(ctx.setConversationStatus).toHaveBeenCalledWith('resolved');
  });
});

describe('http_request handler', () => {
  it('2xx -> edge success com webhook_response', async () => {
    const ctx = makeCtx();
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://x.test/a' }),
      ctx,
    );
    expect(r).toMatchObject({ status: 'SUCCESS', edgeHandle: 'success' });
    if (r.status === 'SUCCESS') expect(r.variables?.['webhook_response']).toBeDefined();
  });
  it('5xx retenta e cai em error', async () => {
    const httpRequest = vi.fn(async () => ({ status: 500, ok: false, body: null, headers: {} }));
    const ctx = makeCtx({ httpRequest });
    const r = await httpRequestHandler.execute(
      node({
        method: 'GET',
        url: 'https://x.test/a',
        retryPolicy: { maxAttempts: 2, initialDelayMs: 0 },
      }),
      ctx,
    );
    expect(r).toMatchObject({ edgeHandle: 'error' });
    expect(httpRequest).toHaveBeenCalledTimes(2);
  });
});

describe('external_notify (biestavel)', () => {
  it('CUSTOM envia e (sem wait) -> SUCCESS', async () => {
    const ctx = makeCtx();
    const r = await externalNotifyHandler.execute(
      node({
        target: 'CUSTOM',
        channelId: '00000000-0000-0000-0000-000000000009',
        customPhone: '+5511999',
        text: 'oi',
      }),
      ctx,
    );
    expect(r.status).toBe('SUCCESS');
    expect(ctx.sendMessage).toHaveBeenCalled();
  });
  it('phone indisponivel -> ERROR', async () => {
    const ctx = makeCtx();
    const r = await externalNotifyHandler.execute(
      node({
        target: 'RESPONSIBLE',
        channelId: '00000000-0000-0000-0000-000000000009',
        text: 'oi',
      }),
      ctx,
    );
    expect(r.status).toBe('ERROR');
  });
});

describe('pipeline handlers (F5-S16)', () => {
  it('add_tag sem contactId e no-op SUCCESS (sem tocar DB)', async () => {
    const ctx = makeCtx({ contactId: null });
    const r = await addTagHandler.execute(
      node({ tagId: '00000000-0000-0000-0000-0000000000cc' }),
      ctx,
    );
    expect(r.status).toBe('SUCCESS');
    expect(ctx.log).toHaveBeenCalled();
  });
});
