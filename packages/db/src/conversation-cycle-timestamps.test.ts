import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import { channels, conversations, workspaces } from './schema';

// F55-S01 — `conversations.first_response_at|resolved_at|closed_at`: round-trip,
// default NULL e isolamento RLS (as colunas herdam a policy existente da tabela).

let wsA = '';
let wsB = '';
let channelA = '';

beforeAll(async () => {
  const db = getDb(); // owner → bypassa RLS no setup
  const sfx = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(workspaces)
    .values({ name: `Cycle A ${sfx}`, slug: `cycle-a-${sfx}` })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Cycle B ${sfx}`, slug: `cycle-b-${sfx}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces de teste.');
  wsA = a.id;
  wsB = b.id;

  const [ch] = await db
    .insert(channels)
    .values({
      workspaceId: wsA,
      provider: 'meta_whatsapp',
      name: `WA cycle ${sfx}`,
      phoneNumberId: `pnid-cyc-${sfx}`,
      wabaId: `waba-cyc-${sfx}`,
    })
    .returning();
  if (!ch) throw new Error('Falha ao criar channel A.');
  channelA = ch.id;
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('conversations — timestamps de ciclo (F55-S01)', () => {
  it('default NULL: conversa nova não tem nenhum marco preenchido', async () => {
    const db = getDb();
    const [conv] = await db
      .insert(conversations)
      .values({ workspaceId: wsA, channelId: channelA, remoteId: `null-${randomUUID()}` })
      .returning();
    if (!conv) throw new Error('Falha ao criar conversa.');
    expect(conv.firstResponseAt).toBeNull();
    expect(conv.resolvedAt).toBeNull();
    expect(conv.closedAt).toBeNull();
  });

  it('round-trip: grava e lê os 3 timestamps com fidelidade ao instante', async () => {
    const db = getDb();
    const firstResponseAt = new Date('2026-01-02T10:00:00.000Z');
    const resolvedAt = new Date('2026-01-02T11:30:00.000Z');
    const closedAt = new Date('2026-01-02T12:00:00.000Z');

    const [conv] = await db
      .insert(conversations)
      .values({
        workspaceId: wsA,
        channelId: channelA,
        remoteId: `rt-${randomUUID()}`,
        status: 'closed',
        firstResponseAt,
        resolvedAt,
        closedAt,
      })
      .returning();
    if (!conv) throw new Error('Falha ao criar conversa.');

    expect(conv.firstResponseAt?.toISOString()).toBe(firstResponseAt.toISOString());
    expect(conv.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());
    expect(conv.closedAt?.toISOString()).toBe(closedAt.toISOString());

    const [reloaded] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conv.id));
    if (!reloaded) throw new Error('Falha ao recarregar conversa.');
    expect(reloaded.firstResponseAt?.toISOString()).toBe(firstResponseAt.toISOString());
    expect(reloaded.resolvedAt?.toISOString()).toBe(resolvedAt.toISOString());
    expect(reloaded.closedAt?.toISOString()).toBe(closedAt.toISOString());
  });

  it('RLS: workspace B não enxerga a conversa (com marcos) de A', async () => {
    const db = getDb();
    const [conv] = await db
      .insert(conversations)
      .values({
        workspaceId: wsA,
        channelId: channelA,
        remoteId: `rls-${randomUUID()}`,
        status: 'resolved',
        resolvedAt: new Date('2026-01-03T09:00:00.000Z'),
      })
      .returning();
    if (!conv) throw new Error('Falha ao criar conversa.');

    const seenByA = await withWorkspace(wsA, (tx) => tx.select().from(conversations));
    expect(seenByA.some((c) => c.id === conv.id)).toBe(true);
    expect(seenByA.every((c) => c.workspaceId === wsA)).toBe(true);

    const seenByB = await withWorkspace(wsB, (tx) => tx.select().from(conversations));
    expect(seenByB.some((c) => c.id === conv.id)).toBe(false);
  });
});
