/**
 * F73-S03 — escopo fino do Copiloto (ADR-003 §4), contra o Postgres de dev.
 *
 * Por papel (os 5) e por time `private`: conversas pela régua da inbox (F30), negócios do
 * AGENT ("os seus" ou com conversa visível), contatos por `contact.view` e
 * `resolveVisible` tratando invisível como inexistente.
 *
 * Cenário (um departamento, um time T):
 *   cA  conversa do time T atribuída ao AGENT A
 *   cB  conversa do time T atribuída ao AGENT B
 *   d1  negócio do A, sem conversa
 *   d2  negócio do B, ligado a cA
 *   d3  negócio do B, ligado a cB
 *   d4  negócio do B, sem conversa
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { ROLES, type Role } from '@hm/shared';
import { resolveCopilotPrincipal, type CopilotPrincipal } from './principal';
import { contactScope, conversationScope, dealScope, resolveVisible } from './scope';
import { seedCopilotWorkspace, type SeededWorkspace } from './test-fixtures';

let seeded: SeededWorkspace;
let other: SeededWorkspace;
let ws = '';
let agentB = '';
let teamId = '';
let contactId = '';
const conv = { a: '', b: '' };
const deal = { d1: '', d2: '', d3: '', d4: '' };
let otherDeal = '';

async function principalOf(memberId: string, workspaceId = ws): Promise<CopilotPrincipal> {
  const p = await withWorkspace(workspaceId, (tx) =>
    resolveCopilotPrincipal(tx, { workspaceId, memberId }),
  );
  if (!p) throw new Error('principal');
  return p;
}

async function visibleConversations(p: CopilotPrincipal): Promise<string[]> {
  return withWorkspace(ws, async (tx) => {
    const scope = conversationScope(p);
    const rows = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.workspaceId, ws), ...(scope ? [scope] : [])));
    return rows.map((r) => r.id).sort();
  });
}

async function visibleDeals(p: CopilotPrincipal): Promise<string[]> {
  return withWorkspace(ws, async (tx) => {
    const scope = dealScope(p);
    const rows = await tx
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(and(eq(schema.deals.workspaceId, ws), ...(scope ? [scope] : [])));
    return rows.map((r) => r.id).sort();
  });
}

const sorted = (...ids: string[]): string[] => [...ids].sort();

async function setTeamVisibility(value: 'private' | 'shared'): Promise<void> {
  await getDb()
    .update(schema.teams)
    .set({ peerVisibility: value })
    .where(eq(schema.teams.id, teamId));
}

beforeAll(async () => {
  seeded = await seedCopilotWorkspace({ label: 'Scope' });
  other = await seedCopilotWorkspace({ label: 'Scope other' });
  ws = seeded.workspaceId;
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const agentA = seeded.members.AGENT.id;
  // Segundo atendente do mesmo time (o seed tem um por papel).
  const [b] = await db
    .insert(schema.members)
    .values({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `scope-agent-b-${sfx}@t.local`,
      role: 'AGENT',
      status: 'active',
    })
    .returning();
  if (!b) throw new Error('agent B');
  agentB = b.id;

  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId: ws,
      provider: 'meta_whatsapp',
      name: `Canal ${sfx}`,
      phoneNumberId: `pnid-${sfx}`,
      wabaId: `waba-${sfx}`,
    })
    .returning();
  const [dept] = await db
    .insert(schema.departments)
    .values({ workspaceId: ws, name: `Dept ${sfx}` })
    .returning();
  if (!ch || !dept) throw new Error('canal/dept');
  const [team] = await db
    .insert(schema.teams)
    .values({
      workspaceId: ws,
      departmentId: dept.id,
      name: `Time ${sfx}`,
      peerVisibility: 'private',
    })
    .returning();
  if (!team) throw new Error('time');
  teamId = team.id;
  await db.insert(schema.teamMembers).values([
    { workspaceId: ws, teamId, memberId: agentA, role: 'member' },
    { workspaceId: ws, teamId, memberId: agentB, role: 'member' },
    { workspaceId: ws, teamId, memberId: seeded.members.SUPERVISOR.id, role: 'lead' },
  ]);

  const [contact] = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws, displayName: 'Maria Souza', phone: '+5511987654321' })
    .returning();
  if (!contact) throw new Error('contato');
  contactId = contact.id;

  const mkConv = async (assignedTo: string, remote: string): Promise<string> => {
    const [c] = await db
      .insert(schema.conversations)
      .values({
        workspaceId: ws,
        channelId: ch.id,
        contactId,
        remoteId: `${remote}-${sfx}`,
        departmentId: dept.id,
        teamId,
        assignedTo,
      })
      .returning();
    if (!c) throw new Error('conversa');
    return c.id;
  };
  conv.a = await mkConv(agentA, 'ca');
  conv.b = await mkConv(agentB, 'cb');

  const [pipeline] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: ws, name: `Funil ${sfx}` })
    .returning();
  if (!pipeline) throw new Error('pipeline');
  const [stage] = await db
    .insert(schema.stages)
    .values({ workspaceId: ws, pipelineId: pipeline.id, name: 'Novo', position: 0 })
    .returning();
  if (!stage) throw new Error('estágio');
  const mkDeal = async (title: string, ownerId: string, conversationId: string | null) => {
    const [d] = await db
      .insert(schema.deals)
      .values({
        workspaceId: ws,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId,
        conversationId,
        ownerId,
        title,
      })
      .returning();
    if (!d) throw new Error('negócio');
    return d.id;
  };
  deal.d1 = await mkDeal('D1 do A', agentA, null);
  deal.d2 = await mkDeal('D2 do B com cA', agentB, conv.a);
  deal.d3 = await mkDeal('D3 do B com cB', agentB, conv.b);
  deal.d4 = await mkDeal('D4 do B', agentB, null);

  // Um negócio de OUTRO workspace, para provar o isolamento de tenant.
  const [p2] = await db
    .insert(schema.pipelines)
    .values({ workspaceId: other.workspaceId, name: 'Outro' })
    .returning();
  const [s2] = p2
    ? await db
        .insert(schema.stages)
        .values({ workspaceId: other.workspaceId, pipelineId: p2.id, name: 'X', position: 0 })
        .returning()
    : [];
  const [c2] = await db
    .insert(schema.contacts)
    .values({ workspaceId: other.workspaceId, displayName: 'Fora' })
    .returning();
  if (!p2 || !s2 || !c2) throw new Error('outro workspace');
  const [d2] = await db
    .insert(schema.deals)
    .values({
      workspaceId: other.workspaceId,
      pipelineId: p2.id,
      stageId: s2.id,
      contactId: c2.id,
      title: 'Negócio alheio',
    })
    .returning();
  if (!d2) throw new Error('negócio alheio');
  otherDeal = d2.id;
});

afterAll(async () => {
  await seeded?.cleanup();
  await other?.cleanup();
  await closeDb();
});

describe('conversationScope', () => {
  it('OWNER e ADMIN: sem filtro (null) e veem tudo', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const p = await principalOf(seeded.members[role].id);
      expect(conversationScope(p)).toBeNull();
      expect(await visibleConversations(p)).toEqual(sorted(conv.a, conv.b));
    }
  });

  it('time private: o AGENT vê só a sua; o líder (SUPERVISOR) vê as duas', async () => {
    await setTeamVisibility('private');
    expect(await visibleConversations(await principalOf(seeded.members.AGENT.id))).toEqual([
      conv.a,
    ]);
    expect(await visibleConversations(await principalOf(agentB))).toEqual([conv.b]);
    expect(await visibleConversations(await principalOf(seeded.members.SUPERVISOR.id))).toEqual(
      sorted(conv.a, conv.b),
    );
  });

  it('time shared: o AGENT vê as do departamento', async () => {
    await setTeamVisibility('shared');
    expect(await visibleConversations(await principalOf(seeded.members.AGENT.id))).toEqual(
      sorted(conv.a, conv.b),
    );
    await setTeamVisibility('private');
  });

  it('READONLY lê toda a inbox (mesma régua da tela)', async () => {
    expect(await visibleConversations(await principalOf(seeded.members.READONLY.id))).toEqual(
      sorted(conv.a, conv.b),
    );
  });
});

describe('dealScope', () => {
  it('AGENT (time private): os seus + os com conversa visível; nunca o resto', async () => {
    await setTeamVisibility('private');
    const p = await principalOf(seeded.members.AGENT.id);
    expect(dealScope(p)).not.toBeNull();
    expect(await visibleDeals(p)).toEqual(sorted(deal.d1, deal.d2));
  });

  it('AGENT (time shared): a conversa do colega fica visível e o negócio dela também', async () => {
    await setTeamVisibility('shared');
    const p = await principalOf(seeded.members.AGENT.id);
    expect(await visibleDeals(p)).toEqual(sorted(deal.d1, deal.d2, deal.d3));
    await setTeamVisibility('private');
  });

  it('OWNER, ADMIN, SUPERVISOR e READONLY (pipeline.view): todos, sem filtro', async () => {
    for (const role of ['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'] as const) {
      const p = await principalOf(seeded.members[role].id);
      expect(dealScope(p)).toBeNull();
      expect(await visibleDeals(p)).toEqual(sorted(deal.d1, deal.d2, deal.d3, deal.d4));
    }
  });
});

describe('contactScope', () => {
  it('os 5 papéis têm contact.view: sem filtro', async () => {
    for (const role of ROLES) {
      expect(contactScope(await principalOf(seeded.members[role].id))).toBeNull();
    }
  });
});

describe('resolveVisible', () => {
  it('visível: rótulo mínimo, sem telefone nem e-mail', async () => {
    const p = await principalOf(seeded.members.AGENT.id);
    const got = await withWorkspace(ws, (tx) =>
      resolveVisible(tx, p, { type: 'deal', id: deal.d2 }),
    );
    expect(got).toEqual({ type: 'deal', id: deal.d2, label: 'D2 do B com cA' });
    const c = await withWorkspace(ws, (tx) =>
      resolveVisible(tx, p, { type: 'contact', id: contactId }),
    );
    expect(c).toEqual({ type: 'contact', id: contactId, label: 'Maria Souza' });
    const cv = await withWorkspace(ws, (tx) =>
      resolveVisible(tx, p, { type: 'conversation', id: conv.a }),
    );
    expect(cv?.label).toBe('Maria Souza');
    expect(JSON.stringify([got, c, cv])).not.toContain('98765');
  });

  it('invisível = inexistente (null), igual a um id que não existe', async () => {
    await setTeamVisibility('private');
    const p = await principalOf(seeded.members.AGENT.id);
    const run = (type: 'deal' | 'conversation', id: string) =>
      withWorkspace(ws, (tx) => resolveVisible(tx, p, { type, id }));
    expect(await run('deal', deal.d3)).toBeNull();
    expect(await run('deal', deal.d4)).toBeNull();
    expect(await run('conversation', conv.b)).toBeNull();
    expect(await run('deal', randomUUID())).toBeNull();
  });

  it('o mesmo id é visível para o líder do time', async () => {
    const p = await principalOf(seeded.members.SUPERVISOR.id);
    const got = await withWorkspace(ws, (tx) =>
      resolveVisible(tx, p, { type: 'deal', id: deal.d3 }),
    );
    expect(got?.id).toBe(deal.d3);
  });

  it('id de outro workspace e id que não é UUID → null', async () => {
    const owner = await principalOf(seeded.members.OWNER.id);
    expect(
      await withWorkspace(ws, (tx) => resolveVisible(tx, owner, { type: 'deal', id: otherDeal })),
    ).toBeNull();
    expect(
      await withWorkspace(ws, (tx) => resolveVisible(tx, owner, { type: 'deal', id: "1' or 1=1" })),
    ).toBeNull();
  });

  it('campanha exige campaign.list: AGENT não vê nem o que existe', async () => {
    const agent = await principalOf(seeded.members.AGENT.id);
    expect(
      await withWorkspace(ws, (tx) =>
        resolveVisible(tx, agent, { type: 'campaign', id: randomUUID() }),
      ),
    ).toBeNull();
  });

  it('principal de outro workspace não resolve membro daqui', async () => {
    const p = await withWorkspace(other.workspaceId, (tx) =>
      resolveCopilotPrincipal(tx, {
        workspaceId: other.workspaceId,
        memberId: seeded.members.OWNER.id,
      }),
    );
    expect(p).toBeNull();
  });

  it('papéis são os 5 reais', () => {
    const roles: readonly Role[] = ROLES;
    expect(roles).toEqual(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY']);
  });
});
