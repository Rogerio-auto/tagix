import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import { members, plans, workspaces } from './schema';

let wsA = '';
let wsB = '';

beforeAll(async () => {
  const db = getDb(); // conecta como owner → bypassa RLS (setup)
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const planId = free?.id ?? null;
  const suffix = randomUUID().slice(0, 8);

  const [a] = await db
    .insert(workspaces)
    .values({ name: 'RLS A', slug: `rls-a-${suffix}`, planId })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: 'RLS B', slug: `rls-b-${suffix}`, planId })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces de teste.');
  wsA = a.id;
  wsB = b.id;

  await db.insert(members).values({
    workspaceId: wsA,
    authUserId: randomUUID(),
    email: `a-${suffix}@test.local`,
    role: 'OWNER',
    status: 'active',
  });
  await db.insert(members).values({
    workspaceId: wsB,
    authUserId: randomUUID(),
    email: `b-${suffix}@test.local`,
    role: 'OWNER',
    status: 'active',
  });
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('RLS multi-tenant', () => {
  it('workspace A só enxerga os próprios membros', async () => {
    const rows = await withWorkspace(wsA, (tx) => tx.select().from(members));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.workspaceId === wsA)).toBe(true);
    expect(rows.some((m) => m.workspaceId === wsB)).toBe(false);
  });

  it('workspace B não enxerga membros de A', async () => {
    const rows = await withWorkspace(wsB, (tx) => tx.select().from(members));
    expect(rows.every((m) => m.workspaceId === wsB)).toBe(true);
    expect(rows.some((m) => m.workspaceId === wsA)).toBe(false);
  });
});
