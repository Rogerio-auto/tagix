import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { withWorkspace } from '../rls';
import { agents, members, subscriptions, workspaces } from '../schema';
import { ensureTestPlanCatalog } from '../testing/plan-catalog';
import { slugCandidate, slugifyWorkspaceName } from './slug';
import { provisionWorkspaceWithOwner, TRIAL_DAYS } from './provision';

const created: string[] = [];

beforeAll(async () => {
  await ensureTestPlanCatalog();
});

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

  it('grava trial_ends_at = now + 15 dias, o mesmo instante em workspaces e subscriptions', async () => {
    const sfx = randomUUID().slice(0, 8);
    const before = Date.now();
    const res = await provisionWorkspaceWithOwner({
      ownerEmail: `trial-${sfx}@signup.test`,
      ownerName: 'Trial',
      authUserId: randomUUID(),
      workspaceName: `Trial ${sfx}`,
    });
    created.push(res.workspaceId);
    expect(TRIAL_DAYS).toBe(15);

    const db = getDb();
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, res.workspaceId));
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, res.workspaceId));
    const wsEnd = ws?.trialEndsAt?.getTime() ?? 0;
    const day = 24 * 60 * 60 * 1000;
    // Relógio do banco vs. do teste: tolerância de 1 min para o skew do container.
    expect(wsEnd).toBeGreaterThan(before + 15 * day - 60_000);
    expect(wsEnd).toBeLessThan(Date.now() + 15 * day + 60_000);
    expect(sub?.trialEndsAt?.getTime()).toBe(wsEnd);
    expect(ws?.subscriptionStatus).toBe('trial');
  });

  it('idempotente por pessoa: o mesmo authUserId nao cria segunda empresa (created:false)', async () => {
    const sfx = randomUUID().slice(0, 8);
    const email = `idem-${sfx}@signup.test`;
    const authUserId = randomUUID();
    const first = await provisionWorkspaceWithOwner({
      ownerEmail: email,
      ownerName: 'Idem',
      authUserId,
      workspaceName: `Idem ${sfx}`,
    });
    created.push(first.workspaceId);
    const second = await provisionWorkspaceWithOwner({
      ownerEmail: email,
      ownerName: 'Idem',
      authUserId,
      workspaceName: `Idem ${sfx} again`,
    });
    expect(second.created).toBe(false);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.memberId).toBe(first.memberId);
    expect(second.slug).toBe(first.slug);

    const db = getDb();
    const ms = await db.select().from(members).where(eq(members.authUserId, authUserId));
    expect(ms).toHaveLength(1);
  });

  it('idempotente sob corrida: dois signups simultaneos da mesma pessoa criam uma empresa', async () => {
    const sfx = randomUUID().slice(0, 8);
    const authUserId = randomUUID();
    const input = {
      ownerEmail: `race-${sfx}@signup.test`,
      ownerName: 'Race',
      authUserId,
      workspaceName: `Race ${sfx}`,
    };
    const results = await Promise.all([
      provisionWorkspaceWithOwner(input),
      provisionWorkspaceWithOwner(input),
    ]);
    for (const r of results) if (r.created) created.push(r.workspaceId);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]?.workspaceId).toBe(results[1]?.workspaceId);

    const db = getDb();
    const owners = await db.select().from(members).where(eq(members.authUserId, authUserId));
    expect(owners).toHaveLength(1);
  });

  it('convidado em outra empresa que faz signup ganha a propria empresa', async () => {
    const sfx = randomUUID().slice(0, 8);
    const email = `convidado-${sfx}@signup.test`;
    const authUserId = randomUUID();
    const other = await provisionWorkspaceWithOwner({
      ownerEmail: `dono-${sfx}@signup.test`,
      ownerName: 'Dono',
      authUserId: randomUUID(),
      workspaceName: `Outra ${sfx}`,
    });
    created.push(other.workspaceId);
    const db = getDb();
    // A pessoa já é AGENT ativo da outra empresa (entrou por convite).
    await db.insert(members).values({
      workspaceId: other.workspaceId,
      authUserId,
      email,
      role: 'AGENT',
      status: 'active',
    });

    const own = await provisionWorkspaceWithOwner({
      ownerEmail: email,
      ownerName: 'Convidado',
      authUserId,
      workspaceName: `Propria ${sfx}`,
    });
    created.push(own.workspaceId);
    expect(own.created).toBe(true);
    expect(own.workspaceId).not.toBe(other.workspaceId);

    const rows = await db.select().from(members).where(eq(members.authUserId, authUserId));
    expect(rows).toHaveLength(2);
    const ownRow = rows.find((m) => m.workspaceId === own.workspaceId);
    expect(ownRow?.role).toBe('OWNER');
    expect(ownRow?.status).toBe('invited');
    expect(ownRow?.isPlatformAdmin).toBe(false);
    // A membership na outra empresa fica intacta.
    expect(rows.find((m) => m.workspaceId === other.workspaceId)?.role).toBe('AGENT');
  });

  it('grava o aceite de termos no OWNER; termos pela metade sao rejeitados', async () => {
    const sfx = randomUUID().slice(0, 8);
    const acceptedAt = new Date('2026-10-05T12:00:00.000Z');
    const res = await provisionWorkspaceWithOwner({
      ownerEmail: `terms-${sfx}@signup.test`,
      ownerName: 'Terms',
      authUserId: randomUUID(),
      workspaceName: `Terms ${sfx}`,
      termsAcceptedAt: acceptedAt,
      termsVersion: '2026-10-05',
    });
    created.push(res.workspaceId);
    const db = getDb();
    const [m] = await db.select().from(members).where(eq(members.id, res.memberId));
    expect(m?.termsAcceptedAt?.toISOString()).toBe(acceptedAt.toISOString());
    expect(m?.termsVersion).toBe('2026-10-05');

    await expect(
      provisionWorkspaceWithOwner({
        ownerEmail: `terms-half-${sfx}@signup.test`,
        ownerName: 'Half',
        authUserId: randomUUID(),
        workspaceName: `Half ${sfx}`,
        termsAcceptedAt: acceptedAt,
      }),
    ).rejects.toThrow(/termsVersion/);

    // Sem termos: as duas colunas ficam nulas.
    const plain = await provisionWorkspaceWithOwner({
      ownerEmail: `terms-none-${sfx}@signup.test`,
      ownerName: 'None',
      authUserId: randomUUID(),
      workspaceName: `None ${sfx}`,
    });
    created.push(plain.workspaceId);
    const [p] = await db.select().from(members).where(eq(members.id, plain.memberId));
    expect(p?.termsAcceptedAt).toBeNull();
    expect(p?.termsVersion).toBeNull();
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

  it('plano pago da venda (pendingPlanKey) grava subscriptions.pending_plan_key, mas nasce trial', async () => {
    const sfx = randomUUID().slice(0, 8);
    const res = await provisionWorkspaceWithOwner({
      ownerEmail: `paid-${sfx}@signup.test`,
      ownerName: 'Paid',
      authUserId: randomUUID(),
      workspaceName: `Paid ${sfx}`,
      pendingPlanKey: 'pro',
    });
    created.push(res.workspaceId);

    const db = getDb();
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, res.workspaceId));
    // Intenção registrada — mas o tenant SEMPRE nasce free/trial (sem liberar pago).
    expect(sub?.status).toBe('trial');
    expect(sub?.pendingPlanKey).toBe('pro');
  });

  it('plano free ou inexistente → pending_plan_key null (sem checkout)', async () => {
    const sfx = randomUUID().slice(0, 8);
    const free = await provisionWorkspaceWithOwner({
      ownerEmail: `free-${sfx}@signup.test`,
      ownerName: 'Free',
      authUserId: randomUUID(),
      workspaceName: `Free ${sfx}`,
      pendingPlanKey: 'free',
    });
    const bogus = await provisionWorkspaceWithOwner({
      ownerEmail: `bogus-${sfx}@signup.test`,
      ownerName: 'Bogus',
      authUserId: randomUUID(),
      workspaceName: `Bogus ${sfx}`,
      pendingPlanKey: 'nao-existe',
    });
    created.push(free.workspaceId, bogus.workspaceId);

    const db = getDb();
    const [freeSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, free.workspaceId));
    const [bogusSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, bogus.workspaceId));
    expect(freeSub?.pendingPlanKey).toBeNull();
    expect(bogusSub?.pendingPlanKey).toBeNull();
  });
});
