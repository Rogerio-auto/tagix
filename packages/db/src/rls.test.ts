import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import {
  flowExecutions,
  flows,
  flowVersions,
  kbChunks,
  kbDocuments,
  kbFeedback,
  members,
  plans,
  workspaces,
} from './schema';

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

describe('RLS Knowledge Base (F3-S01)', () => {
  it('kb_documents/kb_chunks/kb_feedback isolam por workspace', async () => {
    // Seed em A (como dono, bypassa RLS).
    const db = getDb();
    const [docA] = await db
      .insert(kbDocuments)
      .values({
        workspaceId: wsA,
        title: 'Doc A',
        source: 'manual',
        rawContent: '# A',
        contentSha256: 'a'.repeat(64),
      })
      .returning();
    if (!docA) throw new Error('Falha ao criar kb_document A.');
    const [chunkA] = await db
      .insert(kbChunks)
      .values({ workspaceId: wsA, documentId: docA.id, chunkIndex: 0, content: 'a', contentTokens: 1 })
      .returning();
    if (!chunkA) throw new Error('Falha ao criar kb_chunk A.');
    await db
      .insert(kbFeedback)
      .values({ workspaceId: wsA, documentId: docA.id, chunkId: chunkA.id, helpful: true });

    // Seed em B.
    const [docB] = await db
      .insert(kbDocuments)
      .values({
        workspaceId: wsB,
        title: 'Doc B',
        source: 'manual',
        rawContent: '# B',
        contentSha256: 'b'.repeat(64),
      })
      .returning();
    if (!docB) throw new Error('Falha ao criar kb_document B.');

    // A só enxerga os próprios documentos/chunks/feedback.
    const docsA = await withWorkspace(wsA, (tx) => tx.select().from(kbDocuments));
    expect(docsA.every((d) => d.workspaceId === wsA)).toBe(true);
    expect(docsA.some((d) => d.id === docB.id)).toBe(false);

    const chunksA = await withWorkspace(wsA, (tx) => tx.select().from(kbChunks));
    expect(chunksA.every((c) => c.workspaceId === wsA)).toBe(true);

    const fbA = await withWorkspace(wsA, (tx) => tx.select().from(kbFeedback));
    expect(fbA.every((f) => f.workspaceId === wsA)).toBe(true);

    // B não enxerga nada de A.
    const docsB = await withWorkspace(wsB, (tx) => tx.select().from(kbDocuments));
    expect(docsB.some((d) => d.id === docA.id)).toBe(false);
    const chunksB = await withWorkspace(wsB, (tx) => tx.select().from(kbChunks));
    expect(chunksB.some((c) => c.id === chunkA.id)).toBe(false);
  });
});

describe('RLS Flow Builder (F4-S01)', () => {
  it('flows/flow_versions/flow_executions isolam por workspace', async () => {
    const db = getDb(); // owner bypassa RLS no seed
    const [flowA] = await db
      .insert(flows)
      .values({ workspaceId: wsA, name: 'Flow A', triggerType: 'manual' })
      .returning();
    if (!flowA) throw new Error('Falha ao criar flow A.');
    const [verA] = await db
      .insert(flowVersions)
      .values({ flowId: flowA.id, version: 1, nodes: [], edges: [], triggerConfig: {} })
      .returning();
    if (!verA) throw new Error('Falha ao criar flow_version A.');
    await db.insert(flowExecutions).values({
      workspaceId: wsA,
      flowId: flowA.id,
      flowVersionId: verA.id,
      triggeredBy: 'manual',
    });

    const [flowB] = await db
      .insert(flows)
      .values({ workspaceId: wsB, name: 'Flow B', triggerType: 'manual' })
      .returning();
    if (!flowB) throw new Error('Falha ao criar flow B.');

    const flowsA = await withWorkspace(wsA, (tx) => tx.select().from(flows));
    expect(flowsA.every((f) => f.workspaceId === wsA)).toBe(true);
    expect(flowsA.some((f) => f.id === flowB.id)).toBe(false);

    // flow_versions sem workspace_id proprio: isolada via subquery em flows.
    const versA = await withWorkspace(wsA, (tx) => tx.select().from(flowVersions));
    expect(versA.some((v) => v.id === verA.id)).toBe(true);
    const versB = await withWorkspace(wsB, (tx) => tx.select().from(flowVersions));
    expect(versB.some((v) => v.id === verA.id)).toBe(false);

    const execA = await withWorkspace(wsA, (tx) => tx.select().from(flowExecutions));
    expect(execA.every((e) => e.workspaceId === wsA)).toBe(true);

    const flowsB = await withWorkspace(wsB, (tx) => tx.select().from(flows));
    expect(flowsB.some((f) => f.id === flowA.id)).toBe(false);
  });
});

