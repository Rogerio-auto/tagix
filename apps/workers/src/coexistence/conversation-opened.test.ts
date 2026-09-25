/**
 * F70-S13 — coexistência (eco do app e importação de histórico) que ABRE a conversa
 * publica `conversation.opened`, contra o Postgres dev (RLS real).
 *
 * F70-S14: cada caminho manda a sua origem — eco do WhatsApp e do Instagram
 * `app_echo`, importação de histórico `history` — com o mesmo eventId canônico.
 *
 * Protege: anuncia uma vez; reentrega e conversa existente não regravam; rollback
 * da transação não deixa nada.
 *
 * F70-S16: o anúncio é uma linha da OUTBOX gravada na transação que criou a conversa.
 * Lida por outra conexão (commitada), a conversa que ela anuncia já é visível.
 *
 * O rollback é forçado pela etiqueta de origem (`applyOriginTag`), que roda DENTRO
 * da transação logo depois da conversa nascer — o spy delega ao real fora do teste
 * de falha.
 *
 * F70-S20: o job de download da mídia (`hm.q.media`) também é uma linha da outbox na
 * transação que inseriu a mensagem: commit deixa um job, reentrega não regrava,
 * rollback não deixa nada.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type * as OriginModule from '../inbound/origin';
import { outboxEventsOf, outboxRowsOf, type OutboxTestEvent } from '../outbox/testing';

const origin = vi.hoisted(() => ({ falhar: false }));
vi.mock('../inbound/origin', async (importOriginal) => {
  const real = await importOriginal<typeof OriginModule>();
  return {
    ...real,
    applyOriginTag: async (...args: Parameters<typeof real.applyOriginTag>) => {
      if (origin.falhar) {
        origin.falhar = false;
        throw new Error('falha simulada na etiqueta');
      }
      return real.applyOriginTag(...args);
    },
  };
});

const { DbCoexistencePersistence } = await import('./db-ports');

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('F70-S13 coexistência abre conversa → conversation.opened', () => {
  const sfx = randomUUID().slice(0, 8);
  const phoneNumberId = `PN_F70S13X_${sfx}`;
  const digitos = sfx.replace(/\D/g, '7').padEnd(6, '7').slice(0, 6);
  let workspaceId = '';
  let channelId = '';
  let igChannelId = '';
  const igUserId = `IG_F70S14_${sfx}`;

  const persistence = new DbCoexistencePersistence(
    createLogger('error'),
    undefined,
    undefined,
    new Set(),
  );

  /** A outbox do workspace, na ordem + se a conversa anunciada já é visível. */
  const publicados = async (): Promise<Array<{ draft: OutboxTestEvent; commitada: boolean }>> => {
    const eventos = await outboxEventsOf(workspaceId);
    return Promise.all(
      eventos.map(async (draft) => {
        const id = draft.event === 'conversation.opened' ? String(draft.data['conversationId']) : '';
        const visiveis = await getDb()
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, id));
        return { draft, commitada: visiveis.length === 1 };
      }),
    );
  };

  const conversaDe = async (remoteId: string) => {
    const rows = await getDb()
      .select({ id: schema.conversations.id, contactId: schema.conversations.contactId })
      .from(schema.conversations)
      .where(eq(schema.conversations.remoteId, remoteId));
    return rows;
  };

  const eco = (to: string, externalId: string) => ({
    phoneNumberId,
    externalId,
    to,
    type: 'text',
    text: 'oi, aqui é da loja',
    timestamp: 1_758_000_000,
    raw: {},
  });

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S13 coex', slug: `f70s13-coex-${sfx}`, planId: null })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;
    const [canal] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA coex',
        phoneNumberId,
        wabaId: `WABA_F70S13X_${sfx}`,
      })
      .returning();
    if (!canal) throw new Error('canal não criado');
    channelId = canal.id;
    const [ig] = await db
      .insert(schema.channels)
      .values({ workspaceId, provider: 'meta_instagram', name: 'IG coex', igUserId, fbPageId: `PG_F70S14_${sfx}` })
      .returning();
    if (!ig) throw new Error('canal IG não criado');
    igChannelId = ig.id;
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await closeDb();
  });

  it('eco que abre a conversa → um evento na outbox; reentrega não regrava', async () => {
    const remoteId = `55119${digitos}1`;
    const antes = (await publicados()).length;

    const r = await persistence.persistEcho(eco(remoteId, `wamid.f70s13.${sfx}.1`));
    expect(r).toMatchObject({ resolved: true, inserted: true, startedByApp: true });

    const [conversa] = await conversaDe(remoteId);
    expect(conversa).toBeDefined();
    const novos = (await publicados()).slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]?.commitada).toBe(true);
    expect(novos[0]?.draft).toMatchObject({
      event: 'conversation.opened',
      workspaceId,
      eventId: `${conversa!.id}:opened`,
      data: {
        conversationId: conversa!.id,
        contactId: conversa!.contactId,
        channelId,
        trigger: 'app_echo',
      },
    });

    // Reentrega do mesmo eco e um segundo eco na mesma conversa: nada novo.
    await persistence.persistEcho(eco(remoteId, `wamid.f70s13.${sfx}.1`));
    await persistence.persistEcho(eco(remoteId, `wamid.f70s13.${sfx}.2`));
    expect((await publicados()).length).toBe(antes + 1);
  });

  it('eco do Instagram que abre a conversa → trigger app_echo, uma vez', async () => {
    const remoteId = `IGSID_F70S14_${sfx}`;
    const antes = (await publicados()).length;
    const ecoIg = (externalId: string) => ({
      provider: 'meta_instagram' as const,
      igUserId,
      contactRemoteId: remoteId,
      externalId,
      messageType: 'text' as const,
      content: 'oi, vi seu comentário',
      rawTimestamp: '1758000000000',
    });

    const r = await persistence.persistInstagramEcho(ecoIg(`mid.f70s14.${sfx}.1`));
    expect(r).toMatchObject({ resolved: true, inserted: true });

    const [conversa] = await conversaDe(remoteId);
    expect(conversa).toBeDefined();
    const novos = (await publicados()).slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]?.commitada).toBe(true);
    expect(novos[0]?.draft).toMatchObject({
      event: 'conversation.opened',
      eventId: `${conversa!.id}:opened`,
      data: { conversationId: conversa!.id, channelId: igChannelId, trigger: 'app_echo' },
    });

    await persistence.persistInstagramEcho(ecoIg(`mid.f70s14.${sfx}.1`));
    expect((await publicados()).length).toBe(antes + 1);
  });

  it('eco com rollback → nenhum evento, nenhuma conversa', async () => {
    const remoteId = `55119${digitos}2`;
    const antes = (await publicados()).length;
    origin.falhar = true;

    await expect(persistence.persistEcho(eco(remoteId, `wamid.f70s13.${sfx}.3`))).rejects.toThrow(
      'falha simulada',
    );

    expect((await publicados()).length).toBe(antes);
    expect(await conversaDe(remoteId)).toHaveLength(0);
  });

  it('histórico → um evento por conversa aberta; reprocesso não regrava', async () => {
    const a = `55119${digitos}3`;
    const b = `55119${digitos}4`;
    const lote = {
      phoneNumberId,
      contacts: [{ waId: a, name: 'Alice', raw: {} }, { waId: b, raw: {} }],
      messages: [
        { externalId: `h.${sfx}.1`, from: a, type: 'text', text: 'oi', fromMe: false, raw: {} },
        { externalId: `h.${sfx}.2`, to: a, type: 'text', text: 'olá', fromMe: true, raw: {} },
        { externalId: `h.${sfx}.3`, from: b, type: 'text', text: 'eai', fromMe: false, raw: {} },
      ],
      raw: {},
    };
    const antes = (await publicados()).length;

    await persistence.importHistory(lote);

    const [convA] = await conversaDe(a);
    const [convB] = await conversaDe(b);
    const novos = (await publicados()).slice(antes);
    expect(novos).toHaveLength(2);
    expect(novos.every((p) => p.commitada)).toBe(true);
    expect(novos.map((p) => p.draft.eventId).sort()).toEqual(
      [`${convA!.id}:opened`, `${convB!.id}:opened`].sort(),
    );
    for (const p of novos) {
      expect(p.draft).toMatchObject({ event: 'conversation.opened', data: { trigger: 'history', channelId } });
    }

    await persistence.importHistory(lote);
    expect((await publicados()).length).toBe(antes + 2);
  });

  it('histórico com rollback → nenhum evento, nenhuma conversa', async () => {
    const c = `55119${digitos}5`;
    const antes = (await publicados()).length;
    origin.falhar = true;

    await expect(
      persistence.importHistory({
        phoneNumberId,
        contacts: [],
        messages: [{ externalId: `h.${sfx}.4`, from: c, type: 'text', text: 'oi', raw: {} }],
        raw: {},
      }),
    ).rejects.toThrow('falha simulada');

    expect((await publicados()).length).toBe(antes);
    expect(await conversaDe(c)).toHaveLength(0);
  });

  // ─── F70-S20: download de mídia pela outbox ────────────────────────────────

  /** Jobs de mídia da outbox do workspace (payload do envelope), na ordem. */
  const jobsDeMidia = async () =>
    (await outboxRowsOf(workspaceId))
      .filter((r) => r.kind === 'job' && r.routingKey === 'hm.q.media')
      .map((r) => ({ row: r, payload: r.envelope.payload as Record<string, unknown> }));

  const ecoAudio = (to: string, externalId: string) => ({
    ...eco(to, externalId),
    type: 'audio',
    text: undefined,
    raw: { type: 'audio', audio: { id: `MEDIA-${externalId}`, mime_type: 'audio/ogg' } },
  });

  it('eco com mídia → um job em hm.q.media na transação; reentrega não regrava', async () => {
    const remoteId = `55119${digitos}6`;
    const externalId = `wamid.f70s20.${sfx}.1`;
    const antes = (await jobsDeMidia()).length;

    const r = await persistence.persistEcho(ecoAudio(remoteId, externalId));
    expect(r).toMatchObject({ resolved: true, inserted: true });

    const novos = (await jobsDeMidia()).slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]?.row).toMatchObject({ exchange: '', routingKey: 'hm.q.media', status: 'pending' });
    expect(novos[0]?.row.envelope).toMatchObject({ type: 'inbound.media.requested', workspaceId });
    expect(novos[0]?.payload).toEqual({
      provider: 'meta_whatsapp',
      externalId,
      mediaRef: { refOrUrl: `MEDIA-${externalId}`, mimeType: 'audio/ogg' },
      routing: { phoneNumberId },
    });
    const [msg] = await getDb()
      .select({ mediaStatus: schema.messages.mediaStatus })
      .from(schema.messages)
      .where(eq(schema.messages.externalId, externalId));
    expect(msg?.mediaStatus).toBe('pending');

    await persistence.persistEcho(ecoAudio(remoteId, externalId));
    expect((await jobsDeMidia()).length).toBe(antes + 1);
  });

  it('eco com mídia e rollback → nem mensagem nem job', async () => {
    const remoteId = `55119${digitos}7`;
    const externalId = `wamid.f70s20.${sfx}.2`;
    const antes = (await jobsDeMidia()).length;
    origin.falhar = true;

    await expect(persistence.persistEcho(ecoAudio(remoteId, externalId))).rejects.toThrow(
      'falha simulada',
    );

    expect((await jobsDeMidia()).length).toBe(antes);
    const msgs = await getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.externalId, externalId));
    expect(msgs).toHaveLength(0);
  });

  it('histórico com mídia → um job por mensagem inserida; reprocesso não regrava', async () => {
    const d = `55119${digitos}8`;
    const lote = {
      phoneNumberId,
      contacts: [{ waId: d, raw: {} }],
      messages: [
        {
          externalId: `h.f70s20.${sfx}.img`,
          from: d,
          type: 'image',
          fromMe: false,
          raw: { type: 'image', image: { id: `IMG-${sfx}`, mime_type: 'image/jpeg' } },
        },
        { externalId: `h.f70s20.${sfx}.txt`, from: d, type: 'text', text: 'oi', fromMe: false, raw: {} },
      ],
      raw: {},
    };
    const antes = (await jobsDeMidia()).length;

    await persistence.importHistory(lote);
    const novos = (await jobsDeMidia()).slice(antes);
    expect(novos.map((j) => j.payload['externalId'])).toEqual([`h.f70s20.${sfx}.img`]);

    await persistence.importHistory(lote);
    expect((await jobsDeMidia()).length).toBe(antes + 1);
  });
});
