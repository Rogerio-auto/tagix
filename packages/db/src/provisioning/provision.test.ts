import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import { agents, members, subscriptions, workspaces } from '../schema';
import { slugCandidate, slugifyWorkspaceName } from './slug';
import { provisionWorkspaceWithOwner } from './provision';

const created: string[] = [];

afterAll(async () => {
  const db = getDb();
  for (const id of created) await db.delete(workspaces).where(eq(workspaces.id, id));
  await closeDb();
});

describe('slugifyWorkspaceName', () => {
  it('normaliza acentos, espacos e simbolos em kebab ascii', () => {
    expect(slugifyWorkspaceName('Açaí & Cia Ltda.')).toBe('acai-cia-ltda');
    expect(slugifyWorkspaceName('  Espaços   Múltiplos ')).toBe('espacos-multiplos');
  });
  it('nunca retorna vazio', () => {
    expect(slugifyWorkspaceName('!!!')).toBe('workspace');
    expect(slugifyWorkspaceName('')).toBe('workspace');
  });
  it('slugCandidate adiciona sufixo a partir da 2a tentativa', () => {
    expect(slugCandidate('acme', 0)).toBe('acme');
    expect(slugCandidate('acme', 1)).toBe('acme-2');
    expect(slugCandidate('acme', 2)).toBe('acme-3');
  });
});

describe('provisionWorkspaceWithOwner', () => {
  it('cria workspace + member OWNER (sem platform admin) + subscription trial free', async () => {
    const sfx = randomUUID().slice(0, 8);
    const res = await provisionWorkspaceWithOwner({
      ownerEmail: `owner-${sfx}@signup.test`,
      ownerName: 'Owner Teste',
      authUserId: randomUUID(),
      workspaceName: `Acme ${sfx}`,
    });
    created.push(res.workspaceId);
    expect(res.created).toBe(true);
    expect(res.slug).toContain('acme');

    const db = getDb();
    const [m] = await db.select().from(members).where(eq(members.id, res.memberId));
    expect(m?.role).toBe('OWNER');
    // INVARIANTE DE SEGURANCA (T9): nenhum signup self-serve e platform admin.
    expect(m?.isPlatformAdmin).toBe(false);
    // Pre-verify: bloqueio duro de acesso (resolveSession exige status active).
    expect(m?.status).not.toBe('active');

    const subs = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, res.workspaceId));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.status).toBe('trial');
  });

  it('idempotente: re-provisionar o mesmo email nao duplica (created:false)', async () => {
    const sfx = randomUUID().slice(0, 8);
    const email = `idem-${sfx}@signup.test`;
    const first = await provisionWorkspaceWithOwner({
      ownerEmail: email,
      ownerName: 'Idem',
      authUserId: randomUUID(),
      workspaceName: `Idem ${sfx}`,
    });
    created.push(first.workspaceId);
    const second = await provisionWorkspaceWithOwner({
      ownerEmail: email,
      ownerName: 'Idem',
      authUserId: randomUUID(),
      workspaceName: `Idem ${sfx} again`,
    });
    expect(second.created).toBe(false);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.memberId).toBe(first.memberId);

    const db = getDb();
    const ms = await db.select().from(members).where(eq(members.email, email));
    expect(ms).toHaveLength(1);
  });

  it('dedupe de slug: nome colidente gera sufixo incremental', async () => {
    const sfx = randomUUID().slice(0, 8);
    const name = `Colide ${sfx}`;
    const a = await provisionWorkspaceWithOwner({
      ownerEmail: `a-${sfx}@signup.test`,
      ownerName: 'A',
      authUserId: randomUUID(),
      workspaceName: name,
    });
    const b = await provisionWorkspaceWithOwner({
      ownerEmail: `b-${sfx}@signup.test`,
      ownerName: 'B',
      authUserId: randomUUID(),
      workspaceName: name,
    });
    created.push(a.workspaceId, b.workspaceId);
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug.endsWith('-2')).toBe(true);
  });

  it('isolamento RLS: recurso scoped do workspace A nao vaza para B', async () => {
    const sfx = randomUUID().slice(0, 8);
    const a = await provisionWorkspaceWithOwner({
      ownerEmail: `rls-a-${sfx}@signup.test`,
      ownerName: 'RLS A',
      authUserId: randomUUID(),
      workspaceName: `RLS A ${sfx}`,
    });
    const b = await provisionWorkspaceWithOwner({
      ownerEmail: `rls-b-${sfx}@signup.test`,
      ownerName: 'RLS B',
      authUserId: randomUUID(),
      workspaceName: `RLS B ${sfx}`,
    });
    created.push(a.workspaceId, b.workspaceId);

    // Cria um recurso scoped (agent) em A sob RLS.
    const [agentA] = await withWorkspace(a.workspaceId, (tx) =>
      tx
        .insert(agents)
        .values({ workspaceId: a.workspaceId, name: `Agent A ${sfx}`, systemPrompt: 'x' })
        .returning({ id: agents.id }),
    );
    expect(agentA?.id).toBeTruthy();

    // B, sob o proprio escopo, NAO enxerga o agent de A.
    const seenFromB = await withWorkspace(b.workspaceId, (tx) => tx.select().from(agents));
    expect(seenFromB.some((ag) => ag.id === agentA?.id)).toBe(false);

    // A enxerga o proprio.
    const seenFromA = await withWorkspace(a.workspaceId, (tx) => tx.select().from(agents));
    expect(seenFromA.some((ag) => ag.id === agentA?.id)).toBe(true);
  });
});
