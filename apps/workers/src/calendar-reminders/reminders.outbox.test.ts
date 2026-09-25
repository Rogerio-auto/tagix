/**
 * F70-S21 — o job WhatsApp dos lembretes entra na outbox junto da marca de idempotência
 * que o motiva (Postgres dev, RLS real do `withWorkspace`):
 *  - lembrete ao contato: `remindersSent` ganha o offset e UM job, na mesma transação;
 *    repetir o mesmo offset não grava outro;
 *  - ação de vencimento `send_message`: `dueActionDone` e UM job; repetir não grava outro;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a marca nem o job.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import { createLogger } from '@hm/logger';
import type { DueReminder, ReminderDbDeps } from './reminders';

const FORCED = 'F70-S21: rollback forçado pelo teste';
const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (rollback.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { outboxRowsOf } = await import('../outbox/testing');
const { createReminderPorts, REMINDER_TEMPLATE_NAME } = await import('./reminders');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const CALENDAR = randomUUID();
const PHONE = `+55119${WS.slice(0, 8)
  .replace(/[^0-9]/g, '7')
  .padEnd(8, '7')}`;

// O relay de socket e a engine de flows não entram nestes caminhos.
const channel = {
  sendToQueue: () => true,
  publish: () => true,
} as unknown as ReminderDbDeps['channel'];
const ports = createReminderPorts({ channel, logger: createLogger('error') });

async function newEvent(): Promise<string> {
  const startAt = new Date(Date.now() - 60_000);
  const [row] = await getDb()
    .insert(schema.events)
    .values({
      workspaceId: WS,
      calendarId: CALENDAR,
      title: 'Reunião F70-S21',
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      contactId: CONTACT,
    })
    .returning({ id: schema.events.id });
  if (!row) throw new Error('fixture: evento');
  return row.id;
}

function reminderOf(eventId: string): DueReminder {
  return {
    eventId,
    workspaceId: WS,
    calendarId: CALENDAR,
    title: 'Reunião F70-S21',
    startAt: new Date(Date.now() - 60_000),
    type: 'meeting',
    priority: 'medium',
    contactId: CONTACT,
    dealId: null,
    conversationId: null,
    remindersSent: [],
    dueAction: { kind: 'send_message', templateName: 'lembrete_f70s21', languageCode: 'pt_BR' },
    dueActionDone: false,
  };
}

async function metadataOf(eventId: string): Promise<Record<string, unknown>> {
  const [row] = await getDb()
    .select({ metadata: schema.events.metadata })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return (row?.metadata ?? {}) as Record<string, unknown>;
}

async function jobsFor(messageId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.kind === 'job' &&
      (r.envelope.payload as Record<string, unknown>)['messageId'] === messageId,
  );
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S21 lembretes', slug: `f70s21-cal-${WS.slice(0, 8)}` });
  await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, phone: PHONE });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70-S21',
    phoneNumberId: `pn-f70s21-${CHANNEL.slice(0, 8)}`,
    wabaId: `waba-f70s21-${CHANNEL.slice(0, 8)}`,
    isActive: true,
    isDefault: true,
  });
  await db
    .insert(schema.calendars)
    .values({ id: CALENDAR, workspaceId: WS, name: 'Agenda F70-S21', type: 'workspace' });
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('lembrete ao contato → outbox junto da marca (F70-S21)', () => {
  it('commit: offset marcado e UM job template; repetir o offset não grava outro', async () => {
    const eventId = await newEvent();
    expect(await ports.sendContactReminder(reminderOf(eventId), 60)).toBe(true);

    expect((await metadataOf(eventId))['remindersSent']).toEqual([60]);
    const messageId = `event-reminder-${eventId}-60`;
    const jobs = await jobsFor(messageId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ exchange: '', routingKey: 'hm.q.outbound' });
    expect(jobs[0]?.envelope.payload).toMatchObject({
      kind: 'template',
      channelId: CHANNEL,
      chatId: PHONE,
      messageId,
      templateName: REMINDER_TEMPLATE_NAME,
    });

    // Outro tick (ou uma reentrega) com o snapshot antigo: a marca barra o envio.
    expect(await ports.sendContactReminder(reminderOf(eventId), 60)).toBe(false);
    expect(await jobsFor(messageId)).toHaveLength(1);
  });

  it('rollback: nem a marca nem o job ficam', async () => {
    const eventId = await newEvent();
    rollback.armed = true;
    await expect(ports.sendContactReminder(reminderOf(eventId), 1440)).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect((await metadataOf(eventId))['remindersSent']).toBeUndefined();
    expect(await jobsFor(`event-reminder-${eventId}-1440`)).toHaveLength(0);
  });
});

describe.skipIf(!ready)('markReminded grava a marca do tick (F70-S21)', () => {
  // Regressão: o array de offsets ia como lista de parâmetros e a query falhava sempre.
  it('vários offsets de uma vez, sem repetir o que já estava', async () => {
    const eventId = await newEvent();
    expect(await ports.sendContactReminder(reminderOf(eventId), 60)).toBe(true);
    await ports.markReminded(eventId, WS, [1440, 60, 0]);

    const sent = (await metadataOf(eventId))['remindersSent'];
    expect(Array.isArray(sent) ? [...sent].sort((a, b) => Number(a) - Number(b)) : sent).toEqual([
      0, 60, 1440,
    ]);
  });
});

describe.skipIf(!ready)('ação de vencimento send_message → outbox junto da marca (F70-S21)', () => {
  it('commit: dueActionDone e UM job; repetir a ação não grava outro', async () => {
    const eventId = await newEvent();
    await ports.runDueAction(reminderOf(eventId));

    expect((await metadataOf(eventId))['dueActionDone']).toBe(true);
    const messageId = `event-due-action-${eventId}`;
    const jobs = await jobsFor(messageId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.envelope.payload).toMatchObject({
      kind: 'template',
      templateName: 'lembrete_f70s21',
      languageCode: 'pt_BR',
      chatId: PHONE,
    });

    await ports.runDueAction(reminderOf(eventId));
    expect(await jobsFor(messageId)).toHaveLength(1);
  });

  it('rollback: nem a marca nem o job ficam (a falha sobe para o retry do tick)', async () => {
    const eventId = await newEvent();
    rollback.armed = true;
    await expect(ports.runDueAction(reminderOf(eventId))).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect((await metadataOf(eventId))['dueActionDone']).toBeUndefined();
    expect(await jobsFor(`event-due-action-${eventId}`)).toHaveLength(0);
  });
});
