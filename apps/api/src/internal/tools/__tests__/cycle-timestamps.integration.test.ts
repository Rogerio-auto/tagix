/**
 * F55-S02 — gravação dos marcos de ciclo (`resolved_at`/`closed_at`) pelo caminho
 * dos agent tools (workflow-handlers), contra o Postgres dev (RLS real).
 *
 * Prova:
 *  - `mark_resolved` grava `resolved_at` no instante da transição.
 *  - Idempotência: reabrir e resolver de novo NÃO sobrescreve o `resolved_at`
 *    original (guard `coalesce` — marco de "primeira vez").
 *  - `change_conversation_status` → 'closed' grava `closed_at` sem tocar `resolved_at`.
 *  - Reabrir (open) NÃO limpa nenhum marco.
 *
 * Skip automático se o Postgres dev não estiver acessível (CI sem DB).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { buildWorkflowRegistry } from '../workflow-handlers';
import type { ToolCallEnvelope } from '../registry';

const registry = buildWorkflowRegistry();

const WS = randomUUID();
const MEMBER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const AGENT_ID = randomUUID();

let dbAvailable = true;

function env(conversationId: string, args: Record<string, unknown>): ToolCallEnvelope {
  return { workspaceId: WS, conversationId, agentId: AGENT_ID, executionId: randomUUID(), args };
}

/** Invoca um handler do registry sob RLS real do workspace. */
async function runTool(
  toolKey: string,
  conversationId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  const handler = registry.resolve(toolKey);
  if (!handler) throw new Error(`tool não registrada: ${toolKey}`);
  return withWorkspace(WS, (tx) => handler(env(conversationId, args), tx));
}

async function readCycle(
  conversationId: string,
): Promise<{ status: string; resolvedAt: Date | null; closedAt: Date | null }> {
  const [row] = await getDb()
    .select({
      status: schema.conversations.status,
      resolvedAt: schema.conversations.resolvedAt,
      closedAt: schema.conversations.closedAt,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (!row) throw new Error('conversa sumiu');
  return row;
}

async function freshConversation(): Promise<string> {
  const id = randomUUID();
  await getDb().insert(schema.conversations).values({
    id,
    workspaceId: WS,
    channelId: CHANNEL,
    contactId: CONTACT,
    remoteId: `r-${id.slice(0, 12)}`,
    aiMode: 'on',
    status: 'open',
  });
  return id;
}

beforeAll(async () => {
  try {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F55S02 tools', slug: `f55s02-${WS.slice(0, 8)}` });
    await db.insert(schema.members).values({
      id: MEMBER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `m-${MEMBER.slice(0, 8)}@x.test`,
      role: 'AGENT',
      status: 'active',
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'Lead F55',
      phone: `+55119${WS.slice(0, 8)}`,
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal F55',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
  } catch (err) {
    dbAvailable = false;
    console.warn('[cycle-timestamps tools] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  }
  await closeDb();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

describe('F55-S02 — marcos de ciclo via agent tools', () => {
  maybe('mark_resolved grava resolved_at e é idempotente ao reabrir+resolver', async () => {
    const conv = await freshConversation();

    const r1 = await runTool('mark_resolved', conv, { resolution: 'tudo certo' });
    expect(r1.ok).toBe(true);
    const after1 = await readCycle(conv);
    expect(after1.status).toBe('resolved');
    expect(after1.resolvedAt).toBeInstanceOf(Date);
    expect(after1.closedAt).toBeNull();
    const firstResolvedAt = after1.resolvedAt!.getTime();

    // Reabre e resolve de novo — resolved_at NÃO pode mudar (marco da 1ª vez).
    await runTool('change_conversation_status', conv, { target_status: 'open' });
    const reopened = await readCycle(conv);
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeInstanceOf(Date); // reabrir não limpa o marco
    expect(reopened.resolvedAt!.getTime()).toBe(firstResolvedAt);

    await runTool('mark_resolved', conv, { resolution: 'de novo' });
    const after2 = await readCycle(conv);
    expect(after2.resolvedAt!.getTime()).toBe(firstResolvedAt);
  });

  maybe('change_conversation_status → closed grava closed_at sem tocar resolved_at', async () => {
    const conv = await freshConversation();

    await runTool('mark_resolved', conv, { resolution: 'resolvido antes' });
    const resolved = await readCycle(conv);
    const resolvedAt = resolved.resolvedAt!.getTime();

    const rc = await runTool('change_conversation_status', conv, { target_status: 'closed' });
    expect(rc.ok).toBe(true);
    const closed = await readCycle(conv);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeInstanceOf(Date);
    // resolved_at preservado (não foi sobrescrito pela transição de fechamento).
    expect(closed.resolvedAt!.getTime()).toBe(resolvedAt);

    // Reabrir não limpa closed_at nem resolved_at.
    await runTool('change_conversation_status', conv, { target_status: 'open' });
    const reopened = await readCycle(conv);
    expect(reopened.closedAt).toBeInstanceOf(Date);
    expect(reopened.resolvedAt!.getTime()).toBe(resolvedAt);
  });

  maybe('transição para open (sem fechamento) não grava nenhum marco', async () => {
    const conv = await freshConversation();
    await runTool('change_conversation_status', conv, { target_status: 'pending' });
    const after = await readCycle(conv);
    expect(after.status).toBe('pending');
    expect(after.resolvedAt).toBeNull();
    expect(after.closedAt).toBeNull();
  });
});
