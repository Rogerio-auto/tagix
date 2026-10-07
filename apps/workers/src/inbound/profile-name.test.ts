/**
 * F70-S36 — nome de perfil do contato (pushname) guardado a parte do `display_name`.
 *
 *  - contato novo sem nome: `display_name` e `profile_name` preenchidos (compatibilidade F61-S12);
 *  - o nome de perfil muda: `profile_name` acompanha; `display_name` do humano fica intacto;
 *  - mesmo nome de novo: sem escrita (`profile_name_updated_at` não se move);
 *  - WAHA: o nome vem de `metadata.contactName` (notifyName).
 *
 * Toca o Postgres dev (RLS) — pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { InboundEvent } from '@hm/channels';
import { DbInboundPersistence, type InboundSocketPort } from './db-ports';
import type { StatusDeps } from './status';

const url = process.env['DATABASE_URL'];

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};
const noopStatusDeps: StatusDeps = {
  channels: { async resolve() { return null; } },
  persistence: { async applyStatus() { return { outcome: 'not_found' as const }; } },
  socket: { async emitStatusChanged() {} },
  orphan: { async record() {}, async drain() { return null; } },
};

describe.skipIf(!url)('F70-S36 inbound: profile_name', () => {
  const sfx = randomUUID().slice(0, 8);
  const phoneNumberId = 'PN36_' + sfx;
  const wahaSession = 'waha36_' + sfx;
  const digits = sfx.replace(/\D/g, '7').slice(0, 5);
  let workspaceId = '';
  const persistence = new DbInboundPersistence(noopSocket, noopStatusDeps, createLogger('error'));

  function wa(phone: string, ext: string, contactName?: string, ts = '2026-10-07T10:00:00.000Z'): InboundEvent {
    return {
      type: 'message',
      provider: 'meta_whatsapp',
      contactRemoteId: phone,
      ...(contactName !== undefined ? { contactName } : {}),
      externalId: `wamid.${sfx}.${ext}`,
      messageType: 'text',
      content: 'oi',
      rawTimestamp: ts,
    };
  }
  const send = (events: InboundEvent[]) =>
    persistence.persist({ provider: 'meta_whatsapp', routing: { phoneNumberId }, events });
  async function contactOf(phone: string) {
    const [row] = await getDb()
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.phone, phone))
      .limit(1);
    if (!row) throw new Error('contato ausente');
    return row;
  }

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S36', slug: 'f70s36-' + sfx, planId: null })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;
    await db.insert(schema.channels).values([
      { workspaceId, provider: 'meta_whatsapp', name: 'WA', phoneNumberId, wabaId: 'W' + sfx, isActive: true },
      { workspaceId, provider: 'waha', name: 'WAHA', wahaSessionId: wahaSession, isActive: true },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      for (const c of convs) await db.delete(schema.messages).where(eq(schema.messages.conversationId, c.id));
      await db.delete(schema.conversations).where(eq(schema.conversations.workspaceId, workspaceId));
      await db.delete(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  it('contato novo sem nome: display_name e profile_name preenchidos', async () => {
    const phone = `55119${digits}1`;
    await send([wa(phone, 'n1', 'Ana Pushname')]);
    const c = await contactOf(phone);
    expect(c.displayName).toBe('Ana Pushname');
    expect(c.profileName).toBe('Ana Pushname');
    expect(c.profileNameUpdatedAt).not.toBeNull();
  });

  it('o nome de perfil muda: profile_name atualiza e o display_name do humano fica intacto', async () => {
    const phone = `55119${digits}2`;
    await send([wa(phone, 'h1', 'Bia Antiga')]);
    const antes = await contactOf(phone);
    await getDb()
      .update(schema.contacts)
      .set({ displayName: 'Beatriz (cliente VIP)' })
      .where(eq(schema.contacts.id, antes.id));

    await send([wa(phone, 'h2', 'Bia Nova', '2026-10-07T11:00:00.000Z')]);
    const depois = await contactOf(phone);
    expect(depois.profileName).toBe('Bia Nova');
    expect(depois.displayName).toBe('Beatriz (cliente VIP)');
    expect(depois.profileNameUpdatedAt!.getTime()).toBeGreaterThanOrEqual(
      antes.profileNameUpdatedAt!.getTime(),
    );
  });

  it('mesmo nome de novo não reescreve (profile_name_updated_at estável); lote usa o mais recente', async () => {
    const phone = `55119${digits}3`;
    await send([wa(phone, 's1', 'Caio')]);
    const a = await contactOf(phone);
    await send([wa(phone, 's2', 'Caio', '2026-10-07T12:00:00.000Z')]);
    const b = await contactOf(phone);
    expect(b.profileNameUpdatedAt?.getTime()).toBe(a.profileNameUpdatedAt?.getTime());

    // Lote fora de ordem: vence o nome da mensagem de timestamp maior.
    await send([
      wa(phone, 's4', 'Caio Novo', '2026-10-07T14:00:00.000Z'),
      wa(phone, 's3', 'Caio Velho', '2026-10-07T13:00:00.000Z'),
    ]);
    expect((await contactOf(phone)).profileName).toBe('Caio Novo');
  });

  it('sem nome no evento: não apaga o profile_name existente', async () => {
    const phone = `55119${digits}4`;
    await send([wa(phone, 'v1', 'Duda')]);
    await send([wa(phone, 'v2')]);
    expect((await contactOf(phone)).profileName).toBe('Duda');
  });

  it('WAHA: notifyName em metadata.contactName vira profile_name', async () => {
    const phone = `55119${digits}5`;
    await persistence.persist({
      provider: 'waha',
      routing: { wahaSession },
      events: [
        {
          type: 'message',
          provider: 'waha',
          contactRemoteId: phone,
          externalId: `waha.${sfx}.1`,
          messageType: 'text',
          content: 'oi',
          rawTimestamp: '2026-10-07T10:00:00.000Z',
          metadata: { contactName: 'Edu WAHA' },
        },
      ],
    });
    const c = await contactOf(phone);
    expect(c.profileName).toBe('Edu WAHA');
    expect(c.displayName).toBe('Edu WAHA');
  });
});
