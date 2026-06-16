/**
 * Testes do handler `transfer_to_agent` (F34-S05) — authz de alvo + efeito + idempotência.
 *
 * `@hm/db` é mockado: `agentDepartmentsRepo.areAgentsInSameDepartment` é controlável
 * por teste, e o `tx` fake (a) responde às leituras de `conversations`/`channels` e
 * (b) captura o update em `conversations`. O publisher de re-engaje é injetado via
 * `makeTransferToAgentHandler({ reengage })` — sem AMQP real. Sem Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCallEnvelope } from './registry';

// ─── Estado controlável do mock de @hm/db ───────────────────────────────────────

let sameDept = true;
let conversationRow: { contactId: string | null; channelId: string } | null = {
  contactId: 'contact-uuid',
  channelId: 'channel-uuid',
};
let channelRow: { provider: string } | null = { provider: 'meta_whatsapp' };
let conversationUpdated = true;

interface UpdateCapture {
  set: Record<string, unknown>;
}
const updates: UpdateCapture[] = [];

/**
 * `tx` fake: distingue as duas leituras (conversations vs channels) por uma flag
 * de tabela setada em `.from(table)`, e captura o `.update().set()`.
 */
function makeTx() {
  let table = '';
  return {
    select: () => ({
      from: (t: string) => {
        table = t;
        return {
          where: () => ({
            limit: async () => {
              if (table === 'conversations') return conversationRow ? [conversationRow] : [];
              if (table === 'channels') return channelRow ? [channelRow] : [];
              return [];
            },
          }),
        };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set });
        return {
          where: () => ({
            returning: async () => (conversationUpdated ? [{ id: 'conv' }] : []),
          }),
        };
      },
    }),
  };
}

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => ({ key: val }),
}));

vi.mock('@hm/db', () => ({
  schema: {
    conversations: 'conversations',
    channels: 'channels',
  },
  agentDepartmentsRepo: {
    areAgentsInSameDepartment: async () => sameDept,
  },
}));

const { makeTransferToAgentHandler, transferToAgentArgs } = await import('./agent-transfer-handlers');

const WS = '11111111-1111-1111-1111-111111111111';
const AGENT = '22222222-2222-2222-2222-222222222222';
const TARGET = '33333333-3333-3333-3333-333333333333';
const CONV = '44444444-4444-4444-4444-444444444444';

function envelope(over: Partial<ToolCallEnvelope> = {}): ToolCallEnvelope {
  return {
    workspaceId: WS,
    conversationId: CONV,
    agentId: AGENT,
    executionId: 'exec',
    args: { targetAgentId: TARGET, reason: 'cliente quer suporte técnico' },
    ...over,
  };
}

beforeEach(() => {
  sameDept = true;
  conversationRow = { contactId: 'contact-uuid', channelId: 'channel-uuid' };
  channelRow = { provider: 'meta_whatsapp' };
  conversationUpdated = true;
  updates.length = 0;
});

describe('transfer_to_agent — contrato de args', () => {
  it('aceita { targetAgentId, reason }', () => {
    const r = transferToAgentArgs.safeParse({ targetAgentId: TARGET, reason: 'x' });
    expect(r.success).toBe(true);
  });

  it('aceita reason ausente (opcional)', () => {
    const r = transferToAgentArgs.safeParse({ targetAgentId: TARGET });
    expect(r.success).toBe(true);
  });

  it('rejeita targetAgentId não-uuid', () => {
    const r = transferToAgentArgs.safeParse({ targetAgentId: 'nope' });
    expect(r.success).toBe(false);
  });
});

describe('transfer_to_agent — same-dept válido', () => {
  it('grava agent_id no alvo + reativa IA + enfileira re-engaje', async () => {
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope(), makeTx() as never);

    expect(res.ok).toBe(true);
    expect(res.action).toBe('transfer_to_agent');
    expect(res.tableName).toBe('conversations');

    expect(updates).toHaveLength(1);
    expect(updates[0]!.set['agentId']).toBe(TARGET);
    expect(updates[0]!.set['aiMode']).toBe('on');
    expect(updates[0]!.set['aiPausedReason']).toBeNull();

    expect(reengage).toHaveBeenCalledTimes(1);
    expect(reengage).toHaveBeenCalledWith(WS, {
      conversationId: CONV,
      contactId: 'contact-uuid',
      channelId: 'channel-uuid',
      provider: 'meta_whatsapp',
    });
  });

  it('sem contato ou provider conhecido → grava mas não re-engaja', async () => {
    conversationRow = { contactId: null, channelId: 'channel-uuid' };
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope(), makeTx() as never);

    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(reengage).not.toHaveBeenCalled();
  });
});

describe('transfer_to_agent — authz de alvo (outro dept)', () => {
  it('agentes sem dept em comum → { ok:false } sem efeito', async () => {
    sameDept = false;
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope(), makeTx() as never);

    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(updates).toHaveLength(0);
    expect(reengage).not.toHaveBeenCalled();
  });
});

describe('transfer_to_agent — idempotência', () => {
  it('alvo == agente atual → no-op gracioso (ok:true, sem update/enqueue)', async () => {
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope({ args: { targetAgentId: AGENT } }), makeTx() as never);

    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({ noop: true });
    expect(updates).toHaveLength(0);
    expect(reengage).not.toHaveBeenCalled();
  });
});

describe('transfer_to_agent — args inválidos', () => {
  it('targetAgentId ausente → { ok:false } estável sem efeito', async () => {
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope({ args: {} }), makeTx() as never);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Argumentos inválidos para transfer_to_agent.');
    expect(updates).toHaveLength(0);
    expect(reengage).not.toHaveBeenCalled();
  });

  it('conversa ausente no contexto → { ok:false } sem efeito', async () => {
    const reengage = vi.fn(async () => {});
    const handler = makeTransferToAgentHandler({ reengage });
    const res = await handler(envelope({ conversationId: null }), makeTx() as never);

    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(reengage).not.toHaveBeenCalled();
  });
});
