import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { withWorkspace } from './rls';
import { ensureTestPlanCatalog } from './testing/plan-catalog';
import {
  assertRefsInWorkspace,
  invalidReferenceBody,
  requireRefsInWorkspace,
  TenantRefError,
  uniqueViolationConstraint,
} from './tenant-refs';
import {
  channels,
  contacts,
  conversations,
  members,
  pipelines,
  plans,
  stages,
  workspaces,
} from './schema';

/**
 * F70-S11 — `assertRefsInWorkspace` contra o Postgres dev, com dois workspaces reais.
 * O ponto central: um id de B, visto de A, é indistinguível de um UUID que não existe.
 */
interface Fixture {
  ws: string;
  member: string;
  contact: string;
  conversation: string;
  pipeline: string;
  stage: string;
  otherPipeline: string;
  otherStage: string;
}

let A: Fixture;
let B: Fixture;

async function seedWorkspace(label: string, planId: string | null): Promise<Fixture> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [ws] = await db
    .insert(workspaces)
    .values({ name: `Refs ${label}`, slug: `refs-${label.toLowerCase()}-${sfx}`, planId })
    .returning();
  if (!ws) throw new Error('workspace');
  const [member] = await db
    .insert(members)
    .values({
      workspaceId: ws.id,
      authUserId: randomUUID(),
      email: `refs-${sfx}@test.local`,
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  const [contact] = await db
    .insert(contacts)
    .values({ workspaceId: ws.id, displayName: `Contato ${label}` })
    .returning();
  const [channel] = await db
    .insert(channels)
    .values({
      workspaceId: ws.id,
      provider: 'meta_whatsapp',
      name: `WA ${sfx}`,
      phoneNumberId: `pnid-refs-${sfx}`,
      wabaId: `waba-refs-${sfx}`,
    })
    .returning();
  if (!member || !contact || !channel) throw new Error('fixture');
  const [conversation] = await db
    .insert(conversations)
    .values({ workspaceId: ws.id, channelId: channel.id, contactId: contact.id, remoteId: `r-${sfx}` })
    .returning();
  const [pipeline] = await db
    .insert(pipelines)
    .values({ workspaceId: ws.id, name: 'Vendas' })
    .returning();
  const [otherPipeline] = await db
    .insert(pipelines)
    .values({ workspaceId: ws.id, name: 'Pós-venda' })
    .returning();
  if (!conversation || !pipeline || !otherPipeline) throw new Error('fixture');
  const [stage] = await db
    .insert(stages)
    .values({ workspaceId: ws.id, pipelineId: pipeline.id, name: 'Novo', position: 0 })
    .returning();
  const [otherStage] = await db
    .insert(stages)
    .values({ workspaceId: ws.id, pipelineId: otherPipeline.id, name: 'Onboarding', position: 0 })
    .returning();
  if (!stage || !otherStage) throw new Error('fixture');
  return {
    ws: ws.id,
    member: member.id,
    contact: contact.id,
    conversation: conversation.id,
    pipeline: pipeline.id,
    stage: stage.id,
    otherPipeline: otherPipeline.id,
    otherStage: otherStage.id,
  };
}

beforeAll(async () => {
  await ensureTestPlanCatalog();
  const [free] = await getDb().select().from(plans).where(eq(plans.key, 'free'));
  A = await seedWorkspace('A', free?.id ?? null);
  B = await seedWorkspace('B', free?.id ?? null);
});

afterAll(async () => {
  const db = getDb();
  if (A?.ws) await db.delete(workspaces).where(eq(workspaces.id, A.ws));
  if (B?.ws) await db.delete(workspaces).where(eq(workspaces.id, B.ws));
  await closeDb();
});

describe('assertRefsInWorkspace (F70-S11)', () => {
  it('ids do próprio workspace passam, inclusive estágio do pipeline informado', async () => {
    const missing = await withWorkspace(A.ws, (tx) =>
      assertRefsInWorkspace(tx, [
        { kind: 'contact', id: A.contact, field: 'contactId' },
        { kind: 'conversation', id: A.conversation, field: 'conversationId' },
        { kind: 'pipeline', id: A.pipeline, field: 'pipelineId' },
        { kind: 'stage', id: A.stage, field: 'stageId', pipelineId: A.pipeline },
        { kind: 'member', id: A.member, field: 'ownerId' },
      ]),
    );
    expect(missing).toEqual([]);
  });

  it('ids de B vistos de A voltam como ausentes, igual a um UUID inexistente', async () => {
    const ghost = randomUUID();
    const missing = await withWorkspace(A.ws, (tx) =>
      assertRefsInWorkspace(tx, [
        { kind: 'contact', id: B.contact, field: 'contactId' },
        { kind: 'conversation', id: B.conversation, field: 'conversationId' },
        { kind: 'pipeline', id: B.pipeline, field: 'pipelineId' },
        { kind: 'stage', id: B.stage, field: 'stageId' },
        { kind: 'member', id: B.member, field: 'ownerId' },
        { kind: 'contact', id: ghost, field: 'otherContactId' },
      ]),
    );
    expect(missing.map((m) => m.field)).toEqual([
      'contactId',
      'conversationId',
      'pipelineId',
      'stageId',
      'ownerId',
      'otherContactId',
    ]);
    // Sem oráculo: o corpo de "é de B" e o de "não existe" são idênticos.
    const foreign = new TenantRefError([{ kind: 'contact', id: B.contact, field: 'contactId' }]);
    const absent = new TenantRefError([{ kind: 'contact', id: ghost, field: 'contactId' }]);
    expect(foreign.body).toEqual(absent.body);
    expect(JSON.stringify(foreign.body)).not.toContain(B.contact);
  });

  it('estágio de outro pipeline do MESMO workspace é recusado', async () => {
    const missing = await withWorkspace(A.ws, (tx) =>
      assertRefsInWorkspace(tx, [
        { kind: 'pipeline', id: A.pipeline, field: 'pipelineId' },
        { kind: 'stage', id: A.otherStage, field: 'stageId', pipelineId: A.pipeline },
      ]),
    );
    expect(missing).toEqual([{ kind: 'stage', id: A.otherStage, field: 'stageId' }]);
  });

  it('ignora refs vazias e trata id malformado como ausente sem abortar a transação', async () => {
    const result = await withWorkspace(A.ws, async (tx) => {
      const missing = await assertRefsInWorkspace(tx, [
        { kind: 'contact', id: null, field: 'a' },
        { kind: 'contact', id: undefined, field: 'b' },
        { kind: 'contact', id: 'nao-e-uuid', field: 'c' },
        { kind: 'contact', id: A.contact.toUpperCase(), field: 'd' },
      ]);
      // A transação continua viva depois da checagem.
      const rows = await tx.select({ id: contacts.id }).from(contacts);
      return { missing, alive: rows.length > 0 };
    });
    expect(result.missing.map((m) => m.field)).toEqual(['c']);
    expect(result.alive).toBe(true);
  });

  it('agrupa ids repetidos por tipo e confere tudo numa consulta', async () => {
    const missing = await withWorkspace(A.ws, (tx) =>
      assertRefsInWorkspace(tx, [
        { kind: 'member', id: A.member, field: 'ownerId' },
        { kind: 'member', id: A.member, field: 'memberIds' },
        { kind: 'member', id: B.member, field: 'memberIds' },
      ]),
    );
    expect(missing).toEqual([{ kind: 'member', id: B.member, field: 'memberIds' }]);
  });

  it('fora de withWorkspace (papel dono, sem GUC) falha fechado: tudo ausente', async () => {
    const missing = await getDb().transaction((tx) =>
      assertRefsInWorkspace(tx, [{ kind: 'contact', id: A.contact, field: 'contactId' }]),
    );
    expect(missing.map((m) => m.field)).toEqual(['contactId']);
  });

  it('requireRefsInWorkspace lança TenantRefError com o corpo 422 canônico', async () => {
    await expect(
      withWorkspace(A.ws, (tx) =>
        requireRefsInWorkspace(tx, [
          { kind: 'pipeline', id: B.pipeline, field: 'pipelineId' },
          { kind: 'contact', id: B.contact, field: 'contactId' },
        ]),
      ),
    ).rejects.toMatchObject({
      name: 'TenantRefError',
      body: invalidReferenceBody(['contactId', 'pipelineId']),
    });
  });
});

describe('uniqueViolationConstraint', () => {
  it('lê o constraint no erro do driver e no embrulho do Drizzle', () => {
    const driver = { code: '23505', constraint_name: 'uq_deals_conversation' };
    expect(uniqueViolationConstraint(driver)).toBe('uq_deals_conversation');
    expect(uniqueViolationConstraint({ message: 'x', cause: driver })).toBe('uq_deals_conversation');
    expect(uniqueViolationConstraint({ code: '23503' })).toBeNull();
    expect(uniqueViolationConstraint(new Error('x'))).toBeNull();
  });
});
