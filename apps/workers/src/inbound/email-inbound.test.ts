/**
 * F60-S10 — e-mail recebido → conversa, contra o Postgres dev (RLS) e o storage local.
 *
 * Prova os três itens que a F60-S08 deixou em aberto:
 *
 *  1. o anexo vai para o storage (o mesmo `IStorageDriver` do R2) e a mensagem o
 *     referencia por `external_id`, com `metadata.mediaKey` — a chave de que o
 *     `refresh-media-url` reassina a URL;
 *  2. URL de anexo interna é recusada (a guarda em si é coberta em
 *     `email-attachment-fetch.test.ts`; aqui, que a recusa chega na conversa);
 *  3. a thread reusa a conversa: "Re:" com assunto trocado, "Fwd:" de outro
 *     endereço e resposta a uma mensagem NOSSA caem na mesma conversa; mesmo
 *     assunto sem cabeçalho NÃO cai (assunto não decide nada).
 *
 * O canal é resolvido por uma porta falsa sobre um canal WAHA: o banco ainda
 * recusa `channels.provider = 'email'` (ver o bloco do resolver no fim).
 *
 * Pula sem `DATABASE_URL`.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import { LocalDriver } from '@hm/storage';
import { StorageMediaPort } from '../media/adapters';
import type { InboundMessageNewEmit } from './db-ports';
import type { AttachmentFetcher } from './email-attachment-fetch';
import {
  DbEmailChannelResolver,
  attachmentExternalId,
  handleEmailInbound,
  type EmailChannelResolver,
  type EmailInboundDeps,
  type EmailInboundPayload,
} from './email-inbound';
import { threadCandidates } from './email-thread';

const url = process.env['DATABASE_URL'];
const logger = createLogger('error');

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('threadCandidates (puro)', () => {
  it('In-Reply-To primeiro, References da ponta para a raiz, sem o próprio id', () => {
    expect(
      threadCandidates({
        messageId: '<novo@x>',
        inReplyTo: '<r2@x>',
        references: ['<raiz@x>', '<r1@x>', '<r2@x>', '<novo@x>'],
      }),
    ).toEqual(['r2@x', 'r1@x', 'raiz@x']);
  });

  it('cadeia gigante: mantém as pontas e SEMPRE a raiz', () => {
    const refs = Array.from({ length: 300 }, (_, i) => `<r${i}@x>`);
    const c = threadCandidates({ messageId: '<n@x>', inReplyTo: null, references: refs });
    expect(c.length).toBeLessThanOrEqual(25);
    expect(c[0]).toBe('r299@x');
    expect(c[c.length - 1]).toBe('r0@x');
  });

  it('primeira mensagem (sem cabeçalho de thread) não tem candidato', () => {
    expect(threadCandidates({ messageId: '<a@x>', inReplyTo: null, references: [] })).toEqual([]);
  });
});

describe.skipIf(!url)('F60-S10 e-mail recebido → conversa (integração)', () => {
  const sfx = randomUUID().slice(0, 8);
  const caixa = `atendimento+${sfx}@sunrise.test`;
  let workspaceId = '';
  let channelId = '';
  let storageDir = '';
  let driver: LocalDriver;
  const uploads: string[] = [];
  const emitted: InboundMessageNewEmit[] = [];
  const mediaReady: string[] = [];

  const fakeFetch: AttachmentFetcher = async (u) => {
    if (u === 'https://files.provedor.test/foto.jpg') {
      return { ok: true, bytes: JPEG, contentType: 'image/jpeg' };
    }
    return { ok: false, reason: 'unsafe_url' };
  };

  function deps(): EmailInboundDeps {
    const channels: EmailChannelResolver = {
      async resolve(recipients) {
        return recipients.map((r) => r.toLowerCase()).includes(caixa)
          ? { channels: [{ channelId, workspaceId, address: caixa }], ambiguous: [] }
          : { channels: [], ambiguous: [] };
      },
    };
    const port = new StorageMediaPort(driver);
    return {
      channels,
      storage: {
        async upload(input) {
          uploads.push(input.key);
          await port.upload(input);
        },
        publicUrl: (key) => port.publicUrl(key),
      },
      socket: {
        async emitMessageNew(input) {
          emitted.push(input);
        },
      },
      mediaSocket: {
        async emitMediaReady(input) {
          mediaReady.push(input.messageId);
        },
      },
      fetchRemote: fakeFetch,
      logger,
    };
  }

  function email(over: Partial<EmailInboundPayload>): EmailInboundPayload {
    return {
      messageId: `${randomUUID()}@cliente.test`,
      from: 'lead@cliente.test',
      fromName: 'Lead Cliente',
      to: [caixa],
      subject: 'Orçamento da cozinha',
      text: 'Bom dia, segue o projeto.',
      html: '<p>Bom dia, segue o projeto.</p>',
      inReplyTo: null,
      references: [],
      receivedAt: new Date().toISOString(),
      attachments: [],
      rejectedAttachments: [],
      ...over,
    };
  }

  async function processed(payload: EmailInboundPayload) {
    const r = await handleEmailInbound(payload, deps());
    if (r.status !== 'processed') throw new Error(`esperado processed, veio ${r.status}`);
    const d = r.deliveries[0];
    if (d === undefined) throw new Error('sem entrega');
    return d;
  }

  async function messagesOf(conversationId: string) {
    return getDb()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));
  }

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'f60s10-'));
    driver = new LocalDriver({ basePath: storageDir, signingSecret: 'teste' });

    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F60S10', slug: `f60s10-${sfx}`, planId: null })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;
    const [ch] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'waha',
        name: 'Caixa de e-mail (teste)',
        wahaSessionId: `f60s10-${sfx}`,
        isActive: true,
      })
      .returning();
    if (!ch) throw new Error('canal não criado');
    channelId = ch.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      if (convs.length > 0) {
        await db.delete(schema.messages).where(
          inArray(
            schema.messages.conversationId,
            convs.map((c) => c.id),
          ),
        );
      }
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      await db
        .delete(schema.contactIdentities)
        .where(eq(schema.contactIdentities.workspaceId, workspaceId));
      await db.delete(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await rm(storageDir, { recursive: true, force: true });
    await closeDb();
  });

  // Estado compartilhado entre os casos da thread (rodam em ordem).
  let primeiro: EmailInboundPayload;
  let conversaOriginal = '';

  it('anexo recebido vai para o storage e a mensagem o referencia por external_id + mediaKey', async () => {
    primeiro = email({
      attachments: [
        {
          kind: 'inline',
          filename: 'projeto.pdf',
          contentType: 'application/pdf',
          contentId: null,
          contentBase64: PDF.toString('base64'),
          sizeBytes: PDF.length,
        },
        {
          kind: 'remote',
          filename: 'foto.jpg',
          contentType: 'image/jpeg',
          contentId: 'foto1@cliente.test',
          url: 'https://files.provedor.test/foto.jpg',
          sizeBytes: null,
        },
        {
          // URL que a borda deixou passar mas resolve para dentro: a busca recusa.
          kind: 'remote',
          filename: 'meta.pdf',
          contentType: 'application/pdf',
          contentId: null,
          url: 'https://rebind.attacker.test/latest/meta-data',
          sizeBytes: null,
        },
        {
          kind: 'inline',
          filename: 'fatura.pdf.exe',
          contentType: 'application/pdf',
          contentId: null,
          contentBase64: Buffer.from('MZ\x90\x00').toString('base64'),
          sizeBytes: 4,
        },
      ],
      rejectedAttachments: [{ filename: 'interno.pdf', reason: 'unsafe_url' }],
    });

    const d = await processed(primeiro);
    expect(d.createdConversation).toBe(true);
    expect(d.threaded).toBe(false);
    expect(d.attachmentsStored).toBe(2);
    expect(d.attachmentsRejected).toBe(3);
    expect(d.inserted).toBe(3); // corpo + 2 anexos
    conversaOriginal = d.conversationId ?? '';

    const msgs = await messagesOf(conversaOriginal);
    const corpo = msgs.find((m) => m.externalId === primeiro.messageId);
    const pdf = msgs.find((m) => m.externalId === attachmentExternalId(primeiro.messageId, 0));
    const foto = msgs.find((m) => m.externalId === attachmentExternalId(primeiro.messageId, 1));

    // Corpo: texto + metadados do e-mail, com o registro do que foi recusado.
    expect(corpo?.type).toBe('text');
    expect(corpo?.content).toBe('Bom dia, segue o projeto.');
    const meta = corpo?.metadata['email'] as Record<string, unknown>;
    expect(meta['subject']).toBe('Orçamento da cozinha');
    expect(meta['rejectedAttachments']).toEqual([
      { filename: 'interno.pdf', reason: 'unsafe_url' },
      { filename: 'meta.pdf', reason: 'unsafe_url' },
      { filename: 'fatura.pdf.exe', reason: 'blocked_type' },
    ]);

    // Anexo: documento pronto, servido do storage pela key estável.
    expect(pdf?.type).toBe('document');
    expect(pdf?.content).toBe('projeto.pdf');
    expect(pdf?.mediaStatus).toBe('ready');
    expect(pdf?.mediaMime).toBe('application/pdf');
    const key = pdf?.metadata['mediaKey'];
    expect(typeof key).toBe('string');
    expect(String(key)).toMatch(
      new RegExp(`^${workspaceId}/\\d{4}/\\d{2}/\\d{2}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(pdf?.mediaUrl).toContain(encodeURIComponent(String(key)));
    // O objeto existe no storage com os bytes exatos do anexo.
    const noDisco = await readFile(path.join(storageDir, String(key)));
    expect(noDisco.equals(PDF)).toBe(true);
    // A URL assinada é reemitível pela key (é o que o refresh-media-url faz).
    const reassinada = await driver.getSignedUrl(String(key), 60);
    expect(reassinada.url).toContain(encodeURIComponent(String(key)));

    expect(foto?.type).toBe('image');
    expect(foto?.content).toBeNull();
    expect((foto?.metadata['email'] as Record<string, unknown>)['contentId']).toBe(
      'foto1@cliente.test',
    );

    // Tempo real: message:new das 3 e media_ready dos 2 anexos.
    expect(emitted.filter((e) => e.conversationId === conversaOriginal)).toHaveLength(3);
    expect(mediaReady).toHaveLength(2);

    // Contato criado com a identidade de e-mail (F60-S01).
    const [conv] = await getDb()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaOriginal));
    expect(conv?.remoteId).toBe('lead@cliente.test');
    expect(conv?.unreadCount).toBe(3);
    expect(conv?.lastMessagePreview).toBe('Bom dia, segue o projeto.');
    const [identidade] = await getDb()
      .select()
      .from(schema.contactIdentities)
      .where(
        and(
          eq(schema.contactIdentities.workspaceId, workspaceId),
          eq(schema.contactIdentities.value, 'lead@cliente.test'),
        ),
      );
    expect(identidade?.contactId).toBe(conv?.contactId);
  });

  it('reentrega do provedor não duplica mensagem nem sobe o anexo de novo', async () => {
    const antes = uploads.length;
    const d = await processed(primeiro);
    expect(d.duplicate).toBe(true);
    expect(d.inserted).toBe(0);
    expect(uploads.length).toBe(antes);
  });

  it('"Re:" com assunto TROCADO, de outro endereço, cai na mesma conversa', async () => {
    const d = await processed(
      email({
        from: 'lead.pessoal@outro.test',
        subject: 'Re: na verdade, mudou tudo — agora é o banheiro',
        inReplyTo: primeiro.messageId,
        references: [primeiro.messageId],
      }),
    );
    expect(d.threaded).toBe(true);
    expect(d.createdConversation).toBe(false);
    expect(d.conversationId).toBe(conversaOriginal);
  });

  it('"Fwd:" de um colega, só com References, cai na mesma conversa', async () => {
    const d = await processed(
      email({
        from: 'colega@empresa-do-lead.test',
        subject: 'Fwd: Orçamento da cozinha',
        inReplyTo: null,
        references: [`<${primeiro.messageId}>`],
      }),
    );
    expect(d.threaded).toBe(true);
    expect(d.conversationId).toBe(conversaOriginal);
  });

  it('resposta a uma mensagem NOSSA (outbound), três semanas depois, continua de onde parou', async () => {
    const nossa = `${randomUUID()}@leadium.test`;
    await getDb()
      .insert(schema.messages)
      .values({
        workspaceId,
        conversationId: conversaOriginal,
        externalId: nossa,
        direction: 'outbound',
        senderType: 'member',
        type: 'text',
        content: 'Segue a proposta.',
        viewStatus: 'sent',
        createdAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      });

    const d = await processed(
      email({
        from: 'socio@outro-dominio.test',
        subject: 'Assunto completamente novo',
        inReplyTo: `<${nossa}>`,
        references: [],
      }),
    );
    expect(d.threaded).toBe(true);
    expect(d.conversationId).toBe(conversaOriginal);
  });

  it('mesmo assunto SEM cabeçalho de thread, de outra pessoa, NÃO entra na conversa', async () => {
    // Prova de que o assunto não decide nada: se decidisse, isto cairia junto.
    const d = await processed(
      email({ from: 'estranho@nada.test', subject: 'Re: Orçamento da cozinha' }),
    );
    expect(d.threaded).toBe(false);
    expect(d.createdConversation).toBe(true);
    expect(d.conversationId).not.toBe(conversaOriginal);
  });

  it('sem thread, o mesmo endereço reusa a conversa dele', async () => {
    const d = await processed(email({ subject: 'Outra dúvida, e-mail novo' }));
    expect(d.threaded).toBe(false);
    expect(d.createdConversation).toBe(false);
    expect(d.conversationId).toBe(conversaOriginal);
  });

  it('destinatário sem canal: descartado sem tocar em nada', async () => {
    const r = await handleEmailInbound(email({ to: ['ninguem@x.test'] }), deps());
    expect(r).toEqual({ status: 'unresolved', ambiguous: [] });
  });

  it('payload inválido é descartado sem lançar (reentregar não o conserta)', async () => {
    const r = await handleEmailInbound({ messageId: 'x', from: 'não é e-mail' }, deps());
    expect(r.status).toBe('invalid');
    const b64Ruim = await handleEmailInbound(
      email({
        attachments: [
          {
            kind: 'inline',
            filename: 'a.pdf',
            contentType: 'application/pdf',
            contentId: null,
            contentBase64: '%%%',
            sizeBytes: 3,
          },
        ],
      }),
      deps(),
    );
    expect(b64Ruim.status).toBe('invalid');
  });
});

describe.skipIf(!url)('DbEmailChannelResolver (cross-tenant)', () => {
  const sfx = randomUUID().slice(0, 8);
  const endereco = `vendas+${sfx}@dominio.test`;
  const workspaces: string[] = [];
  /**
   * `channels_provider_columns` (migração 0002) ainda não admite `provider = 'email'`:
   * hoje NENHUM canal de e-mail pode existir no banco. Esta lacuna é da F60-S04
   * (que tem `packages/db/drizzle/**` no escopo). Os casos abaixo rodam sozinhos
   * quando a constraint for corrigida.
   */
  let bloqueado = false;

  async function wsCom(endereçoDoCanal: string): Promise<string> {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F60S10r', slug: `f60s10r-${randomUUID().slice(0, 8)}`, planId: null })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaces.push(ws.id);
    await db.insert(schema.channels).values({
      workspaceId: ws.id,
      provider: 'email',
      name: 'E-mail',
      emailFrom: endereçoDoCanal,
      isActive: true,
    });
    return ws.id;
  }

  beforeAll(async () => {
    try {
      await wsCom(endereco);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? `${err.message} ${String(Reflect.get(err, 'cause') ?? '')}` : '';
      if (!/channels_provider_columns/.test(msg)) throw err;
      bloqueado = true;
    }
  });

  afterAll(async () => {
    const db = getDb();
    for (const ws of workspaces) {
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, ws));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
    }
    await closeDb();
  });

  it('resolve pelo destinatário, sem diferenciar caixa', async (ctx) => {
    if (bloqueado) ctx.skip();
    const r = await new DbEmailChannelResolver().resolve([endereco.toUpperCase()]);
    expect(r.channels).toHaveLength(1);
    expect(r.ambiguous).toEqual([]);
  });

  it('endereço em canais de DOIS workspaces é recusado, nunca sorteado', async (ctx) => {
    if (bloqueado) ctx.skip();
    await wsCom(endereco);
    const r = await new DbEmailChannelResolver().resolve([endereco]);
    expect(r.channels).toEqual([]);
    expect(r.ambiguous).toEqual([endereco]);
  });

  it('sem destinatário conhecido, nada', async () => {
    const r = await new DbEmailChannelResolver().resolve([`ninguem+${sfx}@x.test`, '  ']);
    expect(r).toEqual({ channels: [], ambiguous: [] });
  });
});
