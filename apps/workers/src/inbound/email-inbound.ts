/**
 * E-mail recebido → conversa (F60-S10, fecha o que a F60-S08 deixou em aberto).
 *
 * ```
 * payload (Zod — é input externo, mesmo vindo da nossa fila)
 *   → canal pelo endereço de destino (cross-tenant; ambíguo = recusa)
 *   → já persistido? (reentrega do provedor)          → para aqui, sem subir nada
 *   → anexos: política + anti-SSRF + R2                (fora da transação: é rede)
 *   → withWorkspace (RLS):
 *        conversa pela THREAD (cabeçalhos)  → senão pelo endereço → senão cria
 *        mensagem do corpo + uma mensagem por anexo (dedup por external_id)
 *        last_message/unread + eventos de domínio na outbox
 *   → socket: message:new (+ message:media_ready dos anexos)
 * ```
 *
 * ## Por que a thread vence o endereço
 *
 * `conversations` é única por `(channel_id, remote_id)` e o `remote_id` do
 * e-mail é o endereço do contato — é para ele que a resposta sai. Isso já junta
 * as mensagens do MESMO endereço. O que a thread resolve é o resto: o cliente
 * que responde de outro endereço, o colega que encaminha (`Fwd:`) com a cadeia de
 * `References`, a resposta com assunto trocado. Assunto não entra em decisão
 * nenhuma — ver `email-thread.ts`.
 *
 * ## O que este módulo NÃO faz
 *
 * Não escolhe o transporte. Quem o chama é o consumidor da fila que a borda
 * (`POST /webhooks/email/inbound`) alimenta; a ligação acontece junto do
 * provedor real (F60-S04) — hoje a rota está montada inerte, recusando tudo.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeMessageId, threadKeyFrom } from '@hm/channels';
import {
  contactIdentitiesRepo,
  enqueueOutbox,
  getDb,
  normalizeIdentity,
  schema,
  withWorkspace,
  type DbTx,
} from '@hm/db';
import type { Logger } from '@hm/logger';
import { UNPROVEN_CONVERSATION_ORIGIN, previewFor } from '@hm/shared';
import { domainEvents, domainEventsOutbox, type DomainEventDraft } from '@hm/shared/mq';
import type { MediaSocketPort, MediaStoragePort } from '../media/ports';
import type { InboundSocketPort } from './db-ports';
import { fetchEmailAttachment, type AttachmentFetcher } from './email-attachment-fetch';
import {
  ingestEmailAttachments,
  type IncomingEmailAttachment,
  type RejectedEmailAttachment,
  type StoredEmailAttachment,
} from './email-attachments';
import { findThreadConversation } from './email-thread';

// ─── Contrato do payload (Zod) ───────────────────────────────────────────────

/** Base64 estrito. `Buffer.from` aceitaria lixo e devolveria bytes errados em silêncio. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Tetos de string. Generosos: o corte de tamanho de ANEXO é da política (que
 * registra a recusa e entrega o e-mail); estourar aqui descartaria o e-mail
 * inteiro, então só pega o que nenhum provedor legítimo manda.
 */
const MAX_B64 = 64 * 1024 * 1024;
const RFC_LINE = 998;

const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('inline'),
    filename: z.string().min(1).max(255),
    contentType: z.string().max(255),
    contentId: z.string().max(RFC_LINE).nullable(),
    contentBase64: z.string().max(MAX_B64).regex(BASE64),
    sizeBytes: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('remote'),
    filename: z.string().min(1).max(255),
    contentType: z.string().max(255),
    contentId: z.string().max(RFC_LINE).nullable(),
    url: z.string().url().max(2048),
    sizeBytes: z.number().int().nonnegative().nullable(),
  }),
]);

/**
 * Espelha `NormalizedInboundEmail` de `apps/api/src/routes/webhooks/email.ts`.
 * Os dois apps não compartilham tipo; este schema É o contrato na chegada.
 */
export const emailInboundPayloadSchema = z.object({
  messageId: z.string().trim().min(1).max(RFC_LINE),
  from: z.string().trim().email().max(320),
  fromName: z.string().max(256).nullable(),
  to: z.array(z.string().trim().max(320)).max(100),
  subject: z.string().max(RFC_LINE * 4),
  text: z.string().max(2_000_000),
  /** Já sanitizado na borda (`sanitizeEmailHtml`). */
  html: z.string().max(4_000_000),
  inReplyTo: z.string().max(RFC_LINE).nullable(),
  references: z.array(z.string().max(RFC_LINE)).max(500),
  receivedAt: z.string().datetime({ offset: true }),
  attachments: z.array(attachmentSchema).max(100),
  rejectedAttachments: z
    .array(z.object({ filename: z.string().max(255), reason: z.string().max(64) }))
    .max(100),
});

export type EmailInboundPayload = z.infer<typeof emailInboundPayloadSchema>;

// ─── Portas ──────────────────────────────────────────────────────────────────

export interface ResolvedEmailChannel {
  readonly channelId: string;
  readonly workspaceId: string;
  /** Endereço do canal que casou (para log). */
  readonly address: string;
}

export interface EmailChannelResolution {
  readonly channels: readonly ResolvedEmailChannel[];
  /** Endereços configurados em mais de um canal ativo — recusados. */
  readonly ambiguous: readonly string[];
}

export interface EmailChannelResolver {
  resolve(recipients: readonly string[]): Promise<EmailChannelResolution>;
}

export interface EmailInboundDeps {
  readonly channels: EmailChannelResolver;
  readonly storage: Pick<MediaStoragePort, 'upload' | 'publicUrl'>;
  readonly socket: Pick<InboundSocketPort, 'emitMessageNew'>;
  /** Avisa a tela que a mídia do anexo está pronta. Opcional em teste. */
  readonly mediaSocket?: Pick<MediaSocketPort, 'emitMediaReady'>;
  /** Default: `fetchEmailAttachment` (anti-SSRF). Teste injeta. */
  readonly fetchRemote?: AttachmentFetcher;
  readonly logger: Logger;
}

/** O que aconteceu em um canal de destino. */
export interface EmailDelivery {
  readonly channelId: string;
  readonly workspaceId: string;
  readonly conversationId: string | null;
  /** `true` quando a conversa veio da thread (cabeçalhos), não do endereço. */
  readonly threaded: boolean;
  readonly createdConversation: boolean;
  readonly inserted: number;
  /** Reentrega: o e-mail já estava persistido neste canal. */
  readonly duplicate: boolean;
  readonly attachmentsStored: number;
  readonly attachmentsRejected: number;
}

export type EmailInboundResult =
  | { readonly status: 'invalid'; readonly issues: number }
  | { readonly status: 'unresolved'; readonly ambiguous: readonly string[] }
  | { readonly status: 'processed'; readonly deliveries: readonly EmailDelivery[] };

// ─── Resolver default (cross-tenant) ─────────────────────────────────────────

/**
 * Canal pelo endereço de destino. `getDb()` direto: é o passo que DESCOBRE o
 * tenant, como o resolver por `phone_number_id` do inbound Meta.
 *
 * **Endereço em mais de um canal ativo é recusado, não sorteado.** Sem domínio
 * verificado (F60-S04), nada impede um workspace de configurar o endereço de
 * outro como remetente; entregar para "o primeiro" vazaria o e-mail de um
 * cliente para outro tenant. Recusar perde a mensagem e grita no log — é o
 * modo de falha certo.
 */
export class DbEmailChannelResolver implements EmailChannelResolver {
  async resolve(recipients: readonly string[]): Promise<EmailChannelResolution> {
    const enderecos = [
      ...new Set(recipients.map((r) => normalizeIdentity('email', r)).filter((r) => r.length > 0)),
    ];
    if (enderecos.length === 0) return { channels: [], ambiguous: [] };

    const { channels } = schema;
    const rows = await getDb()
      .select({
        channelId: channels.id,
        workspaceId: channels.workspaceId,
        address: sql<string>`lower(${channels.emailFrom})`,
      })
      .from(channels)
      .where(
        and(
          eq(channels.provider, 'email'),
          eq(channels.isActive, true),
          sql`lower(${channels.emailFrom}) in (${sql.join(
            enderecos.map((e) => sql`${e}`),
            sql`, `,
          )})`,
        ),
      );

    const porEndereco = new Map<string, ResolvedEmailChannel[]>();
    for (const r of rows) {
      const lista = porEndereco.get(r.address) ?? [];
      lista.push(r);
      porEndereco.set(r.address, lista);
    }

    const resolvidos = new Map<string, ResolvedEmailChannel>();
    const ambiguous: string[] = [];
    for (const [endereco, lista] of porEndereco) {
      const unico = lista[0];
      if (lista.length !== 1 || unico === undefined) {
        ambiguous.push(endereco);
        continue;
      }
      resolvidos.set(unico.channelId, unico);
    }
    return { channels: [...resolvidos.values()], ambiguous };
  }
}

// ─── Persistência ────────────────────────────────────────────────────────────

/** HTML acima disto não é guardado (o texto fica). Cortar HTML quebraria a marcação. */
const MAX_STORED_HTML = 1024 * 1024;
/** `References` guardado na mensagem: só as pontas, como no envio. */
const MAX_STORED_REFERENCES = 40;

/** `external_id` do anexo: o `Message-ID` do e-mail + a posição. Nunca colide com um cabeçalho. */
export function attachmentExternalId(messageId: string, index: number): string {
  return `${normalizeMessageId(messageId)}#${index}`;
}

/** Já existe este e-mail neste canal? (reentrega do provedor) */
async function alreadyPersisted(
  workspaceId: string,
  channelId: string,
  messageId: string,
): Promise<boolean> {
  const { messages, conversations } = schema;
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.channelId, channelId), eq(messages.externalId, messageId)))
      .limit(1);
    return row !== undefined;
  });
}

/**
 * Contato do remetente: pela identidade de e-mail (F60-S01), depois pela coluna
 * `contacts.email`, e só então cria. Cria com a identidade junto — é ela que faz o
 * próximo e-mail do mesmo endereço cair no mesmo contato.
 */
async function ensureEmailContact(
  tx: DbTx,
  workspaceId: string,
  email: string,
  name: string | null,
): Promise<string> {
  const ref = { kind: 'email' as const, value: email };
  const porIdentidade = await contactIdentitiesRepo.resolve(tx, workspaceId, ref);
  if (porIdentidade !== null) return porIdentidade;

  const { contacts } = schema;
  const [porColuna] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.email, email),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (porColuna !== undefined) {
    await contactIdentitiesRepo.attach(tx, workspaceId, porColuna.id, ref);
    return porColuna.id;
  }

  const nome = name?.trim();
  const [criado] = await tx
    .insert(contacts)
    .values({
      workspaceId,
      email,
      source: 'email',
      ...(nome !== undefined && nome !== '' ? { displayName: nome } : {}),
    })
    .returning({ id: contacts.id });
  if (criado === undefined) throw new Error('email-inbound: contato não materializou após insert.');
  await contactIdentitiesRepo.attach(tx, workspaceId, criado.id, ref);
  return criado.id;
}

interface ResolvedEmailConversation {
  readonly conversationId: string;
  readonly contactId: string | null;
  readonly threaded: boolean;
  readonly created: boolean;
}

/** Conversa pela thread → pelo endereço → cria. */
async function resolveConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  email: EmailInboundPayload,
): Promise<ResolvedEmailConversation> {
  const { conversations } = schema;

  const pelaThread = await findThreadConversation(tx, channelId, {
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
  });
  if (pelaThread !== null) {
    const [conv] = await tx
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, pelaThread))
      .limit(1);
    if (conv !== undefined) {
      return { conversationId: conv.id, contactId: conv.contactId, threaded: true, created: false };
    }
  }

  const remoteId = normalizeIdentity('email', email.from);
  const doEndereco = async (): Promise<{ id: string; contactId: string | null } | undefined> => {
    const [row] = await tx
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
      .limit(1);
    return row;
  };

  const existente = await doEndereco();
  if (existente !== undefined) {
    return {
      conversationId: existente.id,
      contactId: existente.contactId,
      threaded: false,
      created: false,
    };
  }

  const contactId = await ensureEmailContact(tx, workspaceId, remoteId, email.fromName);
  const [criada] = await tx
    .insert(conversations)
    .values({
      workspaceId,
      channelId,
      contactId,
      remoteId,
      kind: 'direct',
      status: 'open',
      aiMode: 'off',
      origin: UNPROVEN_CONVERSATION_ORIGIN,
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({ id: conversations.id });
  if (criada !== undefined) {
    return { conversationId: criada.id, contactId, threaded: false, created: true };
  }

  // Corrida com outro consumidor: ele criou primeiro.
  const corrida = await doEndereco();
  if (corrida === undefined) {
    throw new Error('email-inbound: conversa não materializou após upsert.');
  }
  return {
    conversationId: corrida.id,
    contactId: corrida.contactId,
    threaded: false,
    created: false,
  };
}

interface InsertedEmailMessage {
  readonly messageId: string;
  readonly externalId: string;
  readonly type: string;
  readonly content: string | null;
  readonly mediaUrl: string | null;
}

function bodyMetadata(
  email: EmailInboundPayload,
  stored: readonly StoredEmailAttachment[],
  rejected: readonly { readonly filename: string; readonly reason: string }[],
): Record<string, unknown> {
  const html = email.html.length <= MAX_STORED_HTML ? email.html : null;
  return {
    email: {
      subject: email.subject,
      from: normalizeIdentity('email', email.from),
      fromName: email.fromName,
      to: email.to,
      inReplyTo: email.inReplyTo === null ? null : normalizeMessageId(email.inReplyTo),
      references: email.references.slice(-MAX_STORED_REFERENCES).map(normalizeMessageId),
      threadKey: threadKeyFrom(email),
      html,
      ...(html === null ? { htmlDropped: true } : {}),
      attachments: stored.map((s) => ({
        externalId: attachmentExternalId(email.messageId, s.index),
        filename: s.filename,
        mime: s.mime,
        sizeBytes: s.sizeBytes,
        contentId: s.contentId,
      })),
      rejectedAttachments: rejected,
    },
  };
}

async function insertEmailMessages(
  tx: DbTx,
  workspaceId: string,
  conversationId: string,
  email: EmailInboundPayload,
  stored: readonly StoredEmailAttachment[],
  rejected: readonly { readonly filename: string; readonly reason: string }[],
): Promise<InsertedEmailMessage[]> {
  const { messages } = schema;
  const recebidoEm = new Date(email.receivedAt);
  const messageId = normalizeMessageId(email.messageId);
  const conflito = {
    target: [messages.conversationId, messages.externalId],
    // `uq_messages_external` é parcial: o ON CONFLICT precisa repetir o predicado.
    where: sql`${messages.externalId} is not null`,
  };
  const inseridas: InsertedEmailMessage[] = [];

  const texto = email.text.trim();
  const [corpo] = await tx
    .insert(messages)
    .values({
      workspaceId,
      conversationId,
      externalId: messageId,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: texto.length > 0 ? email.text : null,
      viewStatus: 'delivered',
      createdAt: recebidoEm,
      providerTimestamp: recebidoEm,
      metadata: bodyMetadata(email, stored, rejected),
    })
    .onConflictDoNothing(conflito)
    .returning({ id: messages.id });
  if (corpo !== undefined) {
    inseridas.push({
      messageId: corpo.id,
      externalId: messageId,
      type: 'text',
      content: texto.length > 0 ? email.text : null,
      mediaUrl: null,
    });
  }

  for (const s of stored) {
    // +1ms por posição: corpo primeiro, anexos na ordem em que vieram.
    const em = new Date(recebidoEm.getTime() + s.index + 1);
    const externalId = attachmentExternalId(messageId, s.index);
    // Documento mostra o nome do arquivo (é o rótulo da bolha); mídia visual não
    // ganha legenda inventada.
    const content = s.messageType === 'document' ? s.filename : null;
    const [linha] = await tx
      .insert(messages)
      .values({
        workspaceId,
        conversationId,
        externalId,
        direction: 'inbound',
        senderType: 'contact',
        type: s.messageType,
        content,
        viewStatus: 'delivered',
        mediaUrl: s.mediaUrl,
        mediaMime: s.mime,
        mediaSizeBytes: s.sizeBytes,
        mediaSha256: s.sha256,
        mediaStatus: 'ready',
        createdAt: em,
        providerTimestamp: em,
        // `mediaKey`: a mesma chave que `refresh-media-url` usa para reassinar a
        // URL quando os 7 dias vencem. Sem ela, o anexo vira 404 na semana seguinte.
        metadata: {
          mediaKey: s.key,
          fileName: s.filename,
          email: { parentMessageId: messageId, contentId: s.contentId },
        },
      })
      .onConflictDoNothing(conflito)
      .returning({ id: messages.id });
    if (linha !== undefined) {
      inseridas.push({
        messageId: linha.id,
        externalId,
        type: s.messageType,
        content,
        mediaUrl: s.mediaUrl,
      });
    }
  }
  return inseridas;
}

/** Último recado da conversa: o texto do e-mail; sem texto, o assunto. */
function previewOf(email: EmailInboundPayload): string {
  const texto = email.text.trim();
  if (texto.length > 0) return previewFor('text', texto);
  const assunto = email.subject.trim();
  return assunto.length > 0 ? previewFor('text', assunto) : previewFor('document', null);
}

async function deliverToChannel(
  email: EmailInboundPayload,
  channel: ResolvedEmailChannel,
  deps: EmailInboundDeps,
): Promise<EmailDelivery> {
  const { channelId, workspaceId } = channel;
  const messageId = normalizeMessageId(email.messageId);

  // 1) Reentrega: nada de subir anexo de novo (viraria objeto órfão no R2).
  if (await alreadyPersisted(workspaceId, channelId, messageId)) {
    return {
      channelId,
      workspaceId,
      conversationId: null,
      threaded: false,
      createdConversation: false,
      inserted: 0,
      duplicate: true,
      attachmentsStored: 0,
      attachmentsRejected: 0,
    };
  }

  // 2) Anexos: rede e storage FORA da transação (não segura conexão do banco
  //    enquanto baixa 10 MB de um servidor lento).
  const anexos: readonly IncomingEmailAttachment[] = email.attachments;
  const ingest = await ingestEmailAttachments(workspaceId, anexos, {
    storage: deps.storage,
    fetchRemote: deps.fetchRemote ?? fetchEmailAttachment,
  });
  const recusados: { filename: string; reason: string }[] = [
    ...email.rejectedAttachments,
    ...ingest.rejected.map((r: RejectedEmailAttachment) => ({
      filename: r.filename,
      reason: r.reason,
    })),
  ];
  if (recusados.length > 0) {
    // Só nome e motivo curto: URL de anexo pode carregar token do provedor.
    deps.logger.warn('email-inbound: anexos recusados', {
      workspaceId,
      channelId,
      reasons: recusados.map((r) => r.reason),
    });
  }

  // 3) Persistência sob RLS.
  const outcome = await withWorkspace(workspaceId, async (tx) => {
    const conv = await resolveConversation(tx, workspaceId, channelId, email);
    const inseridas = await insertEmailMessages(
      tx,
      workspaceId,
      conv.conversationId,
      email,
      ingest.stored,
      recusados,
    );

    if (inseridas.length > 0) {
      const { conversations } = schema;
      await tx
        .update(conversations)
        .set({
          lastMessagePreview: previewOf(email),
          lastMessageAt: new Date(email.receivedAt),
          lastMessageFrom: 'contact',
          unreadCount: sql`${conversations.unreadCount} + ${inseridas.length}`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conv.conversationId));
    }

    // Eventos de domínio na outbox, na mesma transação (paridade com o inbound Meta:
    // automações e webhooks de saída enxergam o e-mail como qualquer mensagem).
    const drafts: DomainEventDraft[] = [];
    if (conv.created) {
      drafts.push(
        domainEvents.conversationOpened(workspaceId, {
          conversationId: conv.conversationId,
          contactId: conv.contactId,
          channelId,
          trigger: 'inbound',
        }),
      );
    }
    for (const m of inseridas) {
      drafts.push(
        domainEvents.messageReceived(workspaceId, {
          conversationId: conv.conversationId,
          messageId: m.messageId,
          contactId: conv.contactId,
          channelId,
          type: m.type,
          text: m.content,
        }),
      );
    }
    await enqueueOutbox(tx, domainEventsOutbox(drafts));

    return { conv, inseridas };
  });

  // 4) Tempo real, depois do commit.
  for (const m of outcome.inseridas) {
    await deps.socket.emitMessageNew({
      workspaceId,
      conversationId: outcome.conv.conversationId,
      messageId: m.messageId,
      externalId: m.externalId,
      type: m.type,
      content: m.content,
    });
    if (m.mediaUrl !== null && deps.mediaSocket !== undefined) {
      await deps.mediaSocket.emitMediaReady({
        workspaceId,
        conversationId: outcome.conv.conversationId,
        messageId: m.messageId,
        mediaUrl: m.mediaUrl,
      });
    }
  }

  return {
    channelId,
    workspaceId,
    conversationId: outcome.conv.conversationId,
    threaded: outcome.conv.threaded,
    createdConversation: outcome.conv.created,
    inserted: outcome.inseridas.length,
    duplicate: false,
    attachmentsStored: ingest.stored.length,
    attachmentsRejected: recusados.length,
  };
}

/**
 * Processa um e-mail recebido. Payload inválido NÃO lança (reentregar não o
 * conserta — vai para o log e é descartado); falha de banco lança, para a escada
 * de retry da fila.
 */
export async function handleEmailInbound(
  payload: unknown,
  deps: EmailInboundDeps,
): Promise<EmailInboundResult> {
  const parsed = emailInboundPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    deps.logger.warn('email-inbound: payload inválido — descartado', {
      issues: parsed.error.issues.length,
      paths: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    });
    return { status: 'invalid', issues: parsed.error.issues.length };
  }
  const email = parsed.data;

  const resolution = await deps.channels.resolve(email.to);
  if (resolution.ambiguous.length > 0) {
    deps.logger.error(
      'email-inbound: endereço configurado em mais de um canal ativo — e-mail NÃO entregue a esses canais',
      { ambiguous: resolution.ambiguous },
    );
  }
  if (resolution.channels.length === 0) {
    deps.logger.warn('email-inbound: nenhum canal para os destinatários — descartado', {
      recipients: email.to.length,
    });
    return { status: 'unresolved', ambiguous: resolution.ambiguous };
  }

  const deliveries: EmailDelivery[] = [];
  for (const channel of resolution.channels) {
    deliveries.push(await deliverToChannel(email, channel, deps));
  }

  deps.logger.info('email-inbound: processado', {
    deliveries: deliveries.map((d) => ({
      channelId: d.channelId,
      threaded: d.threaded,
      created: d.createdConversation,
      inserted: d.inserted,
      duplicate: d.duplicate,
      attachmentsStored: d.attachmentsStored,
      attachmentsRejected: d.attachmentsRejected,
    })),
  });
  return { status: 'processed', deliveries };
}
