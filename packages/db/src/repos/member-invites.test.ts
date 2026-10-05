import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../client';
import { memberInvites, members, plans, workspaces } from '../schema';
import { ensureTestPlanCatalog } from '../testing/plan-catalog';
import {
  generateInviteToken,
  hashInviteToken,
  InviteAcceptConflictError,
  INVITE_TTL_DAYS,
  invitesRepo,
} from './member-invites';
import { membershipsRepo } from './memberships';

let wsA = '';
let wsB = '';
let ownerA = '';
let ownerB = '';
const sfx = randomUUID().slice(0, 8);

async function makeWorkspace(name: string): Promise<{ id: string; ownerId: string }> {
  const db = getDb();
  const [free] = await db.select().from(plans).where(eq(plans.key, 'free'));
  const [ws] = await db
    .insert(workspaces)
    .values({
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${sfx}`,
      planId: free?.id ?? null,
    })
    .returning();
  if (!ws) throw new Error('workspace');
  const [owner] = await db
    .insert(members)
    .values({
      workspaceId: ws.id,
      authUserId: randomUUID(),
      email: `owner-${randomUUID().slice(0, 6)}@${name.replace(/\s+/g, '').toLowerCase()}.test`,
      name: `Dono ${name}`,
      role: 'OWNER',
      status: 'active',
    })
    .returning();
  if (!owner) throw new Error('owner');
  return { id: ws.id, ownerId: owner.id };
}

beforeAll(async () => {
  await ensureTestPlanCatalog();
  const a = await makeWorkspace('Inv A');
  const b = await makeWorkspace('Inv B');
  wsA = a.id;
  ownerA = a.ownerId;
  wsB = b.id;
  ownerB = b.ownerId;
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('token do convite', () => {
  it('32 bytes base64url; o banco recebe sha256 hex, nunca o claro', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(generateInviteToken().token).not.toBe(token);
  });
});

describe('invitesRepo', () => {
  it('create → findPendingByTokenHash (privilegiado) → accept cria membro ativo com o papel do convite', async () => {
    const email = `Pessoa-${sfx}@Convite.test`;
    const { token, tokenHash } = generateInviteToken();
    const res = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'AGENT',
      invitedBy: ownerA,
      tokenHash,
    });
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.invite.email).toBe(email.toLowerCase());
    expect(res.invite.sendCount).toBe(1);
    expect(res.invite.lastSentAt).not.toBeNull();
    expect('tokenHash' in res.invite).toBe(false);
    const ttl = res.invite.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan((INVITE_TTL_DAYS * 24 - 1) * 3600_000);

    const lookup = await invitesRepo.findPendingByTokenHash(hashInviteToken(token));
    expect(lookup).toMatchObject({
      id: res.invite.id,
      workspaceId: wsA,
      workspaceName: 'Inv A',
      role: 'AGENT',
      inviterName: 'Dono Inv A',
    });

    // Banner do email da sessão (qualquer caixa).
    const banner = await invitesRepo.listPendingByEmail(email.toUpperCase());
    expect(banner.map((i) => i.id)).toContain(res.invite.id);

    const authUserId = randomUUID();
    const accepted = await invitesRepo.accept({
      workspaceId: wsA,
      inviteId: res.invite.id,
      authUserId,
      email,
      name: 'Pessoa Convidada',
    });
    expect(accepted?.outcome).toBe('created');
    expect(accepted?.member).toMatchObject({
      workspaceId: wsA,
      authUserId,
      role: 'AGENT',
      status: 'active',
      isPlatformAdmin: false,
      invitedBy: ownerA,
      name: 'Pessoa Convidada',
    });
    expect(accepted?.member.joinedAt).not.toBeNull();
    expect(accepted?.invite.acceptedAt).not.toBeNull();
    expect(accepted?.invite.acceptedMemberId).toBe(accepted?.member.id);

    // Uso único: o link morre e o segundo aceite não passa.
    expect(await invitesRepo.findPendingByTokenHash(tokenHash)).toBeNull();
    expect(await invitesRepo.listPendingByEmail(email)).toHaveLength(0);
    expect(
      await invitesRepo.accept({ workspaceId: wsA, inviteId: res.invite.id, authUserId, email }),
    ).toBeNull();

    // Já é membro ativo → novo convite não é criado.
    const again = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'ADMIN',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    expect(again).toEqual({ status: 'already_member', memberId: accepted?.member.id });
  });

  it('aceite exige o email do convite (T2) e respeita a empresa do convite', async () => {
    const email = `t2-${sfx}@convite.test`;
    const { tokenHash } = generateInviteToken();
    const res = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'READONLY',
      invitedBy: ownerA,
      tokenHash,
    });
    if (res.status !== 'created') throw new Error('esperava created');
    const authUserId = randomUUID();
    expect(
      await invitesRepo.accept({
        workspaceId: wsA,
        inviteId: res.invite.id,
        authUserId,
        email: `outra-${sfx}@convite.test`,
      }),
    ).toBeNull();
    // Mesmo id em outra empresa: a RLS de B não enxerga o convite de A.
    expect(
      await invitesRepo.accept({ workspaceId: wsB, inviteId: res.invite.id, authUserId, email }),
    ).toBeNull();
    // Continua vivo.
    expect(await invitesRepo.findPendingByTokenHash(tokenHash)).not.toBeNull();
  });

  it('um pendente por (empresa, email): create repetido devolve pending_exists; outra empresa pode', async () => {
    const email = `dup-${sfx}@convite.test`;
    const first = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'AGENT',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    expect(first.status).toBe('created');
    const second = await invitesRepo.create({
      workspaceId: wsA,
      email: email.toUpperCase(),
      role: 'ADMIN',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    expect(second.status).toBe('pending_exists');
    if (first.status === 'created' && second.status === 'pending_exists') {
      expect(second.invite.id).toBe(first.invite.id);
      expect(second.invite.role).toBe('AGENT');
    }
    const inB = await invitesRepo.create({
      workspaceId: wsB,
      email,
      role: 'AGENT',
      invitedBy: ownerB,
      tokenHash: generateInviteToken().tokenHash,
    });
    expect(inB.status).toBe('created');
  });

  it('expirado: link não resolve; create revoga o expirado e cria um novo', async () => {
    const email = `exp-${sfx}@convite.test`;
    const { tokenHash } = generateInviteToken();
    const first = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'AGENT',
      invitedBy: ownerA,
      tokenHash,
    });
    if (first.status !== 'created') throw new Error('esperava created');
    const liveBefore = await invitesRepo.countPending(wsA);
    await getDb()
      .update(memberInvites)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(memberInvites.id, first.invite.id));

    expect(await invitesRepo.findPendingByTokenHash(tokenHash)).toBeNull();
    // Expirado não conta no teto max_members.
    expect(await invitesRepo.countPending(wsA)).toBe(liveBefore - 1);
    const listed = await invitesRepo.listPendingByWorkspace(wsA);
    expect(listed.some((i) => i.id === first.invite.id)).toBe(true); // admin ainda vê para reenviar
    expect(
      await invitesRepo.accept({
        workspaceId: wsA,
        inviteId: first.invite.id,
        authUserId: randomUUID(),
        email,
      }),
    ).toBeNull();

    const fresh = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'SUPERVISOR',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    expect(fresh.status).toBe('created');
    const old = await invitesRepo.findById(wsA, first.invite.id);
    expect(old?.revokedAt).not.toBeNull();
  });

  it('revoke, recordResend (troca o token, teto) e rotateToken', async () => {
    const email = `resend-${sfx}@convite.test`;
    const first = generateInviteToken();
    const res = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'AGENT',
      invitedBy: ownerA,
      tokenHash: first.tokenHash,
    });
    if (res.status !== 'created') throw new Error('esperava created');

    const second = generateInviteToken();
    const resent = await invitesRepo.recordResend(wsA, res.invite.id, {
      tokenHash: second.tokenHash,
      maxSends: 2,
    });
    expect(resent.ok).toBe(true);
    if (resent.ok) expect(resent.invite.sendCount).toBe(2);
    expect(await invitesRepo.findPendingByTokenHash(first.tokenHash)).toBeNull();
    expect((await invitesRepo.findPendingByTokenHash(second.tokenHash))?.id).toBe(res.invite.id);

    const capped = await invitesRepo.recordResend(wsA, res.invite.id, {
      tokenHash: generateInviteToken().tokenHash,
      maxSends: 2,
    });
    expect(capped).toEqual({ ok: false, reason: 'send_limit' });
    // Outra empresa não alcança o convite.
    expect(
      await invitesRepo.recordResend(wsB, res.invite.id, {
        tokenHash: generateInviteToken().tokenHash,
        maxSends: 10,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });

    const third = generateInviteToken();
    const rotated = await invitesRepo.rotateToken(wsA, res.invite.id, third.tokenHash);
    expect(rotated?.sendCount).toBe(2);
    expect(await invitesRepo.findPendingByTokenHash(second.tokenHash)).toBeNull();
    expect((await invitesRepo.findPendingByTokenHash(third.tokenHash))?.id).toBe(res.invite.id);

    expect(await invitesRepo.revoke(wsB, res.invite.id)).toBeNull();
    const revoked = await invitesRepo.revoke(wsA, res.invite.id);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await invitesRepo.findPendingByTokenHash(third.tokenHash)).toBeNull();
    expect(await invitesRepo.revoke(wsA, res.invite.id)).toBeNull();
    expect(
      await invitesRepo.rotateToken(wsA, res.invite.id, generateInviteToken().tokenHash),
    ).toBeNull();
  });

  it('accept reativa membro removido com o papel do convite; recusa conta diferente de membro ativo', async () => {
    const db = getDb();
    const email = `volta-${sfx}@convite.test`;
    const authUserId = randomUUID();
    const [removed] = await db
      .insert(members)
      .values({ workspaceId: wsA, authUserId, email, role: 'ADMIN', status: 'inactive' })
      .returning();
    const res = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'READONLY',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    if (res.status !== 'created') throw new Error('esperava created');
    const out = await invitesRepo.accept({
      workspaceId: wsA,
      inviteId: res.invite.id,
      authUserId,
      email,
    });
    expect(out?.outcome).toBe('reactivated');
    expect(out?.member.id).toBe(removed?.id);
    expect(out?.member.status).toBe('active');
    expect(out?.member.role).toBe('READONLY');

    // Email de membro ativo com OUTRA conta: conflito, e o convite continua pendente.
    await db
      .update(members)
      .set({ status: 'blocked' })
      .where(eq(members.id, removed?.id ?? ''));
    const res2 = await invitesRepo.create({
      workspaceId: wsA,
      email,
      role: 'AGENT',
      invitedBy: ownerA,
      tokenHash: generateInviteToken().tokenHash,
    });
    if (res2.status !== 'created') throw new Error('esperava created');
    await db
      .update(members)
      .set({ status: 'active' })
      .where(eq(members.id, removed?.id ?? ''));
    await expect(
      invitesRepo.accept({
        workspaceId: wsA,
        inviteId: res2.invite.id,
        authUserId: randomUUID(),
        email,
      }),
    ).rejects.toBeInstanceOf(InviteAcceptConflictError);
    expect((await invitesRepo.findById(wsA, res2.invite.id))?.acceptedAt).toBeNull();
  });

  it('create recusa OWNER (o CHECK do banco também)', async () => {
    await expect(
      invitesRepo.create({
        workspaceId: wsA,
        email: `owner-${sfx}@convite.test`,
        // @ts-expect-error — OWNER não é InvitableRole; o repo recusa em runtime também.
        role: 'OWNER',
        invitedBy: ownerA,
        tokenHash: generateInviteToken().tokenHash,
      }),
    ).rejects.toThrow(/OWNER/);
  });
});

describe('membershipsRepo', () => {
  it('listActiveByAuthUser ignora inactive/blocked/invited e ordena pela última empresa usada', async () => {
    const db = getDb();
    const authUserId = randomUUID();
    const email = `multi-${sfx}@empresas.test`;
    const extra = await Promise.all([
      makeWorkspace('Ms C'),
      makeWorkspace('Ms D'),
      makeWorkspace('Ms E'),
    ]);
    const [c, d, e] = extra;
    if (!c || !d || !e) throw new Error('workspaces');
    try {
      const rows = await db
        .insert(members)
        .values([
          { workspaceId: wsA, authUserId, email, role: 'AGENT', status: 'active' },
          { workspaceId: wsB, authUserId, email, role: 'ADMIN', status: 'active' },
          { workspaceId: c.id, authUserId, email, role: 'AGENT', status: 'inactive' },
          { workspaceId: d.id, authUserId, email, role: 'AGENT', status: 'blocked' },
          { workspaceId: e.id, authUserId, email, role: 'OWNER', status: 'invited' },
        ])
        .returning();
      const inA = rows.find((r) => r.workspaceId === wsA);
      const inB = rows.find((r) => r.workspaceId === wsB);
      const inC = rows.find((r) => r.workspaceId === c.id);
      if (!inA || !inB || !inC) throw new Error('rows');

      const listed = await membershipsRepo.listActiveByAuthUser(authUserId);
      expect(listed.map((m) => m.workspaceId).sort()).toEqual([wsA, wsB].sort());
      expect(listed.find((m) => m.workspaceId === wsB)).toMatchObject({
        memberId: inB.id,
        workspaceName: 'Inv B',
        role: 'ADMIN',
        lastActiveAt: null,
      });

      await membershipsRepo.touchLastActive(inB.id);
      expect((await membershipsRepo.listActiveByAuthUser(authUserId))[0]?.workspaceId).toBe(wsB);
      await membershipsRepo.touchLastActive(inA.id);
      const ordered = await membershipsRepo.listActiveByAuthUser(authUserId);
      expect(ordered.map((m) => m.workspaceId)).toEqual([wsA, wsB]);
      expect(ordered[0]?.lastActiveAt).toBeInstanceOf(Date);

      // touch não mexe em membro não ativo.
      await membershipsRepo.touchLastActive(inC.id);
      const [cRow] = await db.select().from(members).where(eq(members.id, inC.id));
      expect(cRow?.lastActiveAt).toBeNull();

      expect((await membershipsRepo.findActive(authUserId, wsA))?.id).toBe(inA.id);
      expect(await membershipsRepo.findActive(authUserId, c.id)).toBeNull();
      expect(await membershipsRepo.findActive(authUserId, d.id)).toBeNull();
      expect(await membershipsRepo.findActive(authUserId, e.id)).toBeNull();
      expect(await membershipsRepo.findActive(randomUUID(), wsA)).toBeNull();
    } finally {
      await db
        .delete(members)
        .where(and(eq(members.authUserId, authUserId), eq(members.workspaceId, wsA)));
      await db
        .delete(members)
        .where(and(eq(members.authUserId, authUserId), eq(members.workspaceId, wsB)));
      for (const w of extra) await db.delete(workspaces).where(eq(workspaces.id, w.id));
    }
  });
});
