/**
 * F71-S05 (B2) — cota de email de convite no Redis dev: consumida antes do envio, atômica,
 * por empresa e por destinatário entre empresas; cooldown e teto do link público; devolução.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeInviteQuota, createInviteSendQuota } from './invite-quota';

const redisUrl = process.env['REDIS_URL'];

afterAll(async () => {
  await closeInviteQuota();
});

describe.skipIf(!redisUrl)('cota de envio de convite', () => {
  const prefix = () => `invq-test-${randomUUID().slice(0, 8)}`;
  const email = () => `quota-${randomUUID().slice(0, 8)}@t.local`;

  it('teto por empresa/hora: recusa o excedente sem gastar cota', async () => {
    const quota = createInviteSendQuota({ prefix: prefix(), limits: { workspacePerHour: 2 } });
    const ws = randomUUID();
    expect((await quota.consume({ workspaceId: ws, email: email() })).ok).toBe(true);
    expect((await quota.consume({ workspaceId: ws, email: email() })).ok).toBe(true);
    const denied = await quota.consume({ workspaceId: ws, email: email() });
    expect(denied).toMatchObject({ ok: false, reason: 'workspace_hourly' });
    if (!denied.ok) expect(denied.retryAfterSec).toBeGreaterThan(3500);
  });

  it('teto por destinatário soma empresas diferentes (revogar + recriar não zera)', async () => {
    const quota = createInviteSendQuota({ prefix: prefix(), limits: { recipientPerDay: 2 } });
    const to = email();
    expect((await quota.consume({ workspaceId: randomUUID(), email: to })).ok).toBe(true);
    expect((await quota.consume({ workspaceId: randomUUID(), email: to.toUpperCase() })).ok).toBe(true);
    expect(await quota.consume({ workspaceId: randomUUID(), email: to })).toMatchObject({
      ok: false,
      reason: 'recipient_daily',
    });
  });

  it('concorrência: N pedidos simultâneos nunca passam do teto', async () => {
    const quota = createInviteSendQuota({ prefix: prefix(), limits: { workspacePerHour: 5 } });
    const ws = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => quota.consume({ workspaceId: ws, email: email() })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it('link público: cooldown por convite e teto do convite; release devolve', async () => {
    const quota = createInviteSendQuota({
      prefix: prefix(),
      limits: { publicCooldownSec: 60, publicPerInvite: 2 },
    });
    const input = { workspaceId: randomUUID(), email: email(), publicInviteId: randomUUID() };
    const first = await quota.consume(input);
    expect(first.ok).toBe(true);
    const cooling = await quota.consume(input);
    expect(cooling).toMatchObject({ ok: false, reason: 'invite_cooldown' });
    if (!cooling.ok) expect(cooling.retryAfterSec).toBeLessThanOrEqual(60);

    // Devolver solta o cooldown e o contador.
    if (first.ok) await first.release();
    const again = await quota.consume(input);
    expect(again.ok).toBe(true);
    if (again.ok) await again.release();
    expect((await quota.consume(input)).ok).toBe(true);
  });

  it('link público: teto de envios por convite', async () => {
    const quota = createInviteSendQuota({
      prefix: prefix(),
      limits: { publicCooldownSec: 0, publicPerInvite: 2 },
    });
    const input = { workspaceId: randomUUID(), email: email(), publicInviteId: randomUUID() };
    expect((await quota.consume(input)).ok).toBe(true);
    expect((await quota.consume(input)).ok).toBe(true);
    expect(await quota.consume(input)).toMatchObject({ ok: false, reason: 'invite_public_cap' });
  });
});
