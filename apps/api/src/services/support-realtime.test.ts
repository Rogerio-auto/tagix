/**
 * F38-S08 — real-time de suporte. Testa a lógica pura (sem servidor socket, que
 * não sobe no harness): autorização de join por visibilidade e mapeamento de
 * rooms/evento. O fluxo socket fim-a-fim é de QA/staging (S14).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, supportRepo, withWorkspace } from '@hm/db';
import type { SupportThread, SupportMessage } from '@hm/db';
import {
  SUPPORT_PLATFORM_ROOM,
  authorizeSupportThreadJoin,
  resolveSupportEmit,
  supportThreadRoom,
} from './support-realtime';

const { workspaces, members } = schema;

let wsA = '';
let wsB = '';
let memberA = '';
let threadA = '';
const sfx = randomUUID().slice(0, 8);

beforeAll(async () => {
  const db = getDb();
  const [a] = await db.insert(workspaces).values({ name: 'RT A', slug: `rta-${sfx}` }).returning();
  const [b] = await db.insert(workspaces).values({ name: 'RT B', slug: `rtb-${sfx}` }).returning();
  wsA = a!.id;
  wsB = b!.id;
  const [m] = await db
    .insert(members)
    .values({ workspaceId: wsA, authUserId: randomUUID(), email: `rta-${sfx}@t.local`, role: 'AGENT', status: 'active' })
    .returning();
  memberA = m!.id;
  const thread = await withWorkspace(wsA, (tx) =>
    supportRepo.createThread(tx, { workspaceId: wsA, openedBy: memberA, subject: 'rt' }),
  );
  threadA = thread.id;
});

afterAll(async () => {
  const db = getDb();
  if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
  if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
  await closeDb();
});

describe('authorizeSupportThreadJoin', () => {
  it('membro do workspace dono entra; membro de outro workspace é negado', async () => {
    const owner = await authorizeSupportThreadJoin(
      { workspaceId: wsA, memberId: memberA, isPlatformAdmin: false },
      threadA,
    );
    expect(owner).toBe(true);

    const stranger = await authorizeSupportThreadJoin(
      { workspaceId: wsB, memberId: randomUUID(), isPlatformAdmin: false },
      threadA,
    );
    expect(stranger).toBe(false);
  });

  it('platform-admin entra em qualquer thread (bypass)', async () => {
    const admin = await authorizeSupportThreadJoin(
      { workspaceId: wsB, memberId: randomUUID(), isPlatformAdmin: true },
      threadA,
    );
    expect(admin).toBe(true);
  });
});

describe('resolveSupportEmit', () => {
  const thread = { id: threadA || randomUUID() } as SupportThread;
  const message = { id: randomUUID(), threadId: thread.id, body: 'oi' } as SupportMessage;

  it('message → support:message no room do thread + support:platform', () => {
    const out = resolveSupportEmit({ kind: 'message', thread, message });
    expect(out.eventName).toBe('support:message');
    expect(out.rooms).toContain(supportThreadRoom(thread.id));
    expect(out.rooms).toContain(SUPPORT_PLATFORM_ROOM);
  });

  it('thread_opened → support:message com flag opened', () => {
    const out = resolveSupportEmit({ kind: 'thread_opened', thread, message });
    expect(out.eventName).toBe('support:message');
    expect((out.data as { opened: boolean }).opened).toBe(true);
  });

  it('thread_updated → support:thread_updated', () => {
    const out = resolveSupportEmit({ kind: 'thread_updated', thread });
    expect(out.eventName).toBe('support:thread_updated');
    expect(out.rooms).toContain(SUPPORT_PLATFORM_ROOM);
  });
});
