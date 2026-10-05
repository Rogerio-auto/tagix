/**
 * Migração 0094 (F71-S01): convites antigos → member_invites, backfill do trial, idempotência.
 *
 * Reaplica o SQL da migração DUAS vezes sobre dados semeados, dentro de uma transação que é
 * desfeita no fim: prova a idempotência e o movimento de dados sem tocar no banco de dev.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, type DbTx } from './client';
import { memberInvites, members, plans, subscriptions, workspaces } from './schema';
import { ensureTestPlanCatalog } from './testing/plan-catalog';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.resolve(here, '..', 'drizzle', '0094_f71_member_invites.sql'),
  'utf8',
);
const statements = MIGRATION.split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);

class Rollback extends Error {}

async function applyMigration(tx: DbTx): Promise<void> {
  // Os "already exists, skipping" da segunda passada são esperados; sem ruído no relatório.
  await tx.execute(sql`set local client_min_messages = warning`);
  for (const stmt of statements) await tx.execute(sql.raw(stmt));
}

beforeAll(async () => {
  await ensureTestPlanCatalog();
});

afterAll(async () => {
  await closeDb();
});

describe('migração 0094_f71_member_invites', () => {
  it('move convites antigos, preserva o dono pré-verify, faz o backfill do trial e é idempotente', async () => {
    const sfx = randomUUID().slice(0, 8);
    let reachedEnd = false;
    try {
      await getDb().transaction(async (tx) => {
        const [free] = await tx.select().from(plans).where(eq(plans.key, 'free'));
        if (!free) throw new Error('plano free ausente');

        // Empresa em trial sem data, com assinatura também sem data.
        const [ws] = await tx
          .insert(workspaces)
          .values({ name: 'Mig', slug: `mig-${sfx}`, planId: free.id, subscriptionStatus: 'trial' })
          .returning();
        // Empresa em trial cuja assinatura já tem data: o workspace herda a mesma.
        const [ws2] = await tx
          .insert(workspaces)
          .values({
            name: 'Mig2',
            slug: `mig2-${sfx}`,
            planId: free.id,
            subscriptionStatus: 'trial',
          })
          .returning();
        // Empresa ativa: fora do backfill.
        const [ws3] = await tx
          .insert(workspaces)
          .values({
            name: 'Mig3',
            slug: `mig3-${sfx}`,
            planId: free.id,
            subscriptionStatus: 'active',
          })
          .returning();
        if (!ws || !ws2 || !ws3) throw new Error('workspaces');
        await tx
          .insert(subscriptions)
          .values({ workspaceId: ws.id, planId: free.id, status: 'trial' });
        const fixedEnd = new Date('2030-01-01T00:00:00.000Z');
        await tx.insert(subscriptions).values({
          workspaceId: ws2.id,
          planId: free.id,
          status: 'trial',
          trialEndsAt: fixedEnd,
        });

        const [owner] = await tx
          .insert(members)
          .values({
            workspaceId: ws.id,
            authUserId: randomUUID(),
            email: `owner-${sfx}@mig.test`,
            name: 'Dono',
            role: 'OWNER',
            status: 'active',
          })
          .returning();
        if (!owner) throw new Error('owner');
        const invitedAt = new Date('2026-09-01T10:00:00.000Z');
        const legacy = await tx
          .insert(members)
          .values([
            {
              workspaceId: ws.id,
              authUserId: randomUUID(),
              email: `agente-${sfx}@mig.test`,
              role: 'AGENT',
              status: 'invited',
              invitedBy: owner.id,
              invitedAt,
            },
            {
              workspaceId: ws.id,
              authUserId: randomUUID(),
              email: `dono2-${sfx}@mig.test`,
              role: 'OWNER',
              status: 'invited',
              invitedBy: owner.id,
              invitedAt,
            },
          ])
          .returning();
        // Dono pré-verify do signup: invited SEM invited_by — não é convite, fica.
        const [preVerify] = await tx
          .insert(members)
          .values({
            workspaceId: ws2.id,
            authUserId: randomUUID(),
            email: `preverify-${sfx}@mig.test`,
            role: 'OWNER',
            status: 'invited',
          })
          .returning();
        if (!preVerify) throw new Error('preVerify');

        await applyMigration(tx);
        await applyMigration(tx); // idempotente: a segunda passada não falha nem duplica

        // Convites antigos saíram de members…
        const left = await tx
          .select({ id: members.id })
          .from(members)
          .where(
            inArray(
              members.id,
              legacy.map((m) => m.id),
            ),
          );
        expect(left).toHaveLength(0);
        // …e viraram convites pendentes, inutilizáveis até o reenvio.
        const invites = await tx
          .select()
          .from(memberInvites)
          .where(eq(memberInvites.workspaceId, ws.id));
        expect(invites).toHaveLength(2);
        // now() é fixo na transação: compara no banco, sem perder microssegundos no Date.
        const [ttlOk] = Array.from(
          await tx.execute<{ ok: boolean }>(sql`
            select bool_and(expires_at = now() + interval '7 days') as ok
              from member_invites where workspace_id = ${ws.id}
          `),
        );
        expect(ttlOk?.ok).toBe(true);
        for (const inv of invites) {
          expect(inv.tokenHash).toMatch(/^legacy:[0-9a-f]{64}$/);
          expect(inv.invitedBy).toBe(owner.id);
          expect(inv.acceptedAt).toBeNull();
          expect(inv.revokedAt).toBeNull();
          expect(inv.sendCount).toBe(0);
          expect(inv.lastSentAt).toBeNull();
          expect(inv.createdAt.toISOString()).toBe(invitedAt.toISOString());
        }
        expect(invites.find((i) => i.email === `agente-${sfx}@mig.test`)?.role).toBe('AGENT');
        // OWNER por convite não existe: vira ADMIN.
        expect(invites.find((i) => i.email === `dono2-${sfx}@mig.test`)?.role).toBe('ADMIN');

        const [stillPre] = await tx.select().from(members).where(eq(members.id, preVerify.id));
        expect(stillPre?.status).toBe('invited');

        // Backfill do trial.
        const wsRows = await tx
          .select({ id: workspaces.id, end: workspaces.trialEndsAt })
          .from(workspaces)
          .where(inArray(workspaces.id, [ws.id, ws2.id, ws3.id]));
        const subRows = await tx
          .select({ ws: subscriptions.workspaceId, end: subscriptions.trialEndsAt })
          .from(subscriptions)
          .where(inArray(subscriptions.workspaceId, [ws.id, ws2.id]));
        const [trialOk] = Array.from(
          await tx.execute<{ ws_ok: boolean; sub_ok: boolean }>(sql`
            select
              (select trial_ends_at = now() + interval '15 days' from workspaces where id = ${ws.id}) as ws_ok,
              (select trial_ends_at = now() + interval '15 days' from subscriptions where workspace_id = ${ws.id}) as sub_ok
          `),
        );
        expect(trialOk).toEqual({ ws_ok: true, sub_ok: true });
        expect(wsRows.find((r) => r.id === ws2.id)?.end?.toISOString()).toBe(
          fixedEnd.toISOString(),
        );
        expect(subRows.find((r) => r.ws === ws2.id)?.end?.toISOString()).toBe(
          fixedEnd.toISOString(),
        );
        expect(wsRows.find((r) => r.id === ws3.id)?.end).toBeNull();

        reachedEnd = true;
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    expect(reachedEnd).toBe(true);
  });
});
