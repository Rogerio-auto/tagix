/**
 * Persistência direta (`@hm/db` + `withWorkspace`/RLS) do worker de coexistência
 * WhatsApp Business (F39-S04, LIVECHAT.md — modelo de conversas/mensagens).
 *
 * Espelha o estilo do worker inbound (`inbound/db-ports.ts`): resolução de
 * canal→workspace cross-tenant via `getDb()` pelo `phone_number_id` (índice único
 * `uq_channels_phone_number_id`) — é o passo que descobre o tenant, então ainda
 * não há `workspaceId` para escopar RLS — e, a partir daí, TODA mutação roda
 * dentro de `withWorkspace(workspaceId, …)` → `SET LOCAL` de tenant + role
 * `hm_app`.
 *
 * Três fluxos, todos idempotentes ancorados no id externo:
 *
 * - **echo** (`coexistence.echo`): mensagem enviada pelo número via app WhatsApp
 *   Business. Resolve a conversa pelo contato (`to`), insere uma mensagem
 *   **outbound** com `metadata.origin = 'coexistence_echo'`, deduplicada por
 *   `uq_messages_external (conversation_id, external_id)` (`onConflictDoNothing`).
 *
 * - **history** (`coexistence.history`): batch de contatos + mensagens
 *   históricas. Upsert de contatos por `uq_contacts_workspace_phone`
 *   (`onConflictDoNothing`) e de mensagens por `uq_messages_external`. Direção
 *   por `fromMe`. Insert em lote (sem N+1) e seguro sob reprocesso.
 *
 * - **app_state** (`coexistence.app_state`): reflete o estado do número no
 *   `channel` correspondente. NÃO há coluna dedicada — grava em
 *   `channels.metadata.coexistence` (jsonb), sem migração de schema.
 *
 * Idempotência: reprocessar qualquer evento é seguro. O dedup por id externo
 * garante zero duplicação de mensagens/contatos em reentrega/reprocesso.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import type {
  CoexistenceAppStatePayload,
  CoexistenceEchoPayload,
  CoexistenceHistoryBatchPayload,
  CoexistenceHistoryMessagePayload,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type {
  CoexistenceAppStateResult,
  CoexistenceEchoResult,
  CoexistenceHistoryResult,
  CoexistencePersistencePort,
} from './ports';

/** Provider dos canais de coexistência (WhatsApp Business / WABA). */
const COEXISTENCE_PROVIDER = 'meta_whatsapp' as const;

/** Origem gravada em `messages.metadata.origin` para distinguir o app de fora. */
const ECHO_ORIGIN = 'coexistence_echo' as const;
const HISTORY_ORIGIN = 'coexistence_history' as const;

/** Canal resolvido a partir do `phoneNumberId`. */
export interface ResolvedCoexistenceChannel {
  readonly channelId: string;
  readonly workspaceId: string;
}

/**
 * Resolve channel→workspace pelo `phone_number_id`. Lookup cross-tenant com
 * `getDb()` direto (passo que descobre o tenant). Injetável para teste sem DB.
 */
export interface CoexistenceChannelResolver {
  resolve(phoneNumberId: string): Promise<ResolvedCoexistenceChannel | null>;
}

/** Resolver default DB-backed: índice único `uq_channels_phone_number_id`. */
export class DbCoexistenceChannelResolver implements CoexistenceChannelResolver {
  async resolve(phoneNumberId: string): Promise<ResolvedCoexistenceChannel | null> {
    const { channels } = schema;
    const [row] = await getDb()
      .select({ id: channels.id, workspaceId: channels.workspaceId })
      .from(channels)
      .where(
        and(
          eq(channels.provider, COEXISTENCE_PROVIDER),
          eq(channels.isActive, true),
          eq(channels.phoneNumberId, phoneNumberId),
        ),
      )
      .limit(1);
    return row === undefined ? null : { channelId: row.id, workspaceId: row.workspaceId };
  }
}

function toDate(timestamp: number | undefined): Date {
  if (timestamp === undefined) return new Date();
  // Webhooks WhatsApp expõem epoch em segundos; tolera milissegundos.
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function previewOf(text: string | undefined, type: string): string {
  if (typeof text === 'string' && text.length > 0) return text.slice(0, 280);
  return `[${type}]`;
}

/**
 * Persistência default do worker de coexistência via `@hm/db`. Resolve
 * channel→workspace e aplica todo o trecho DB-bound sob RLS.
 */
export class DbCoexistencePersistence implements CoexistencePersistencePort {
  constructor(
    private readonly logger: Logger,
    private readonly channels: CoexistenceChannelResolver = new DbCoexistenceChannelResolver(),
  ) {}

  async persistEcho(payload: CoexistenceEchoPayload): Promise<CoexistenceEchoResult> {
    const channel = await this.channels.resolve(payload.phoneNumberId);
    if (channel === null) {
      this.logger.warn('coexistence: echo sem canal para phoneNumberId — descartado', {
        phoneNumberId: payload.phoneNumberId,
      });
      return { resolved: false, inserted: false };
    }
    const { channelId, workspaceId } = channel;

    const result = await withWorkspace(workspaceId, async (tx) => {
      const contactId = await ensureContact(tx, workspaceId, payload.to);
      const conversationId = await ensureConversation(tx, workspaceId, channelId, payload.to, contactId);

      const [inserted] = await tx
        .insert(schema.messages)
        .values({
          workspaceId,
          conversationId,
          externalId: payload.externalId,
          direction: 'outbound',
          senderType: 'system',
          type: payload.type,
          content: payload.text ?? null,
          viewStatus: 'sent',
          createdAt: toDate(payload.timestamp),
          metadata: { origin: ECHO_ORIGIN },
        })
        .onConflictDoNothing({ target: [schema.messages.conversationId, schema.messages.externalId] })
        .returning({ id: schema.messages.id });

      if (inserted !== undefined) {
        await tx
          .update(schema.conversations)
          .set({
            lastMessagePreview: previewOf(payload.text, payload.type),
            lastMessageAt: toDate(payload.timestamp),
            lastMessageFrom: 'system',
            updatedAt: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));
      }

      return inserted !== undefined;
    });

    return { resolved: true, inserted: result };
  }

  async importHistory(payload: CoexistenceHistoryBatchPayload): Promise<CoexistenceHistoryResult> {
    const channel = await this.channels.resolve(payload.phoneNumberId);
    if (channel === null) {
      this.logger.warn('coexistence: history sem canal para phoneNumberId — descartado', {
        phoneNumberId: payload.phoneNumberId,
      });
      return { resolved: false, contactsInserted: 0, messagesInserted: 0, messagesDeduped: 0 };
    }
    const { channelId, workspaceId } = channel;

    return withWorkspace(workspaceId, async (tx) => {
      // 1) Upsert idempotente de contatos por (workspace, phone=waId). Insert em
      //    lote com onConflictDoNothing → reprocesso não duplica nem N+1.
      const contactRows = payload.contacts.map((c) => ({
        workspaceId,
        phone: c.waId,
        ...(c.name !== undefined ? { displayName: c.name } : {}),
        source: 'whatsapp',
      }));
      let contactsInserted = 0;
      if (contactRows.length > 0) {
        const created = await tx
          .insert(schema.contacts)
          .values(contactRows)
          .onConflictDoNothing({ target: [schema.contacts.workspaceId, schema.contacts.phone] })
          .returning({ id: schema.contacts.id });
        contactsInserted = created.length;
      }

      // 2) Mensagens: agrupa por contraparte (waId) → conversa, insere em lote
      //    deduplicando por uq_messages_external. A contraparte é `from` quando o
      //    histórico é recebido (fromMe=false) e `to` quando enviado (fromMe=true).
      const byCounterpart = new Map<string, CoexistenceHistoryMessagePayload[]>();
      for (const msg of payload.messages) {
        const counterpart = counterpartOf(msg);
        if (counterpart === null) continue;
        const list = byCounterpart.get(counterpart) ?? [];
        list.push(msg);
        byCounterpart.set(counterpart, list);
      }

      let messagesInserted = 0;
      let messagesTotal = 0;
      for (const [counterpart, msgs] of byCounterpart) {
        const contactId = await ensureContact(tx, workspaceId, counterpart);
        const conversationId = await ensureConversation(
          tx,
          workspaceId,
          channelId,
          counterpart,
          contactId,
        );

        const rows = msgs.map((m) => ({
          workspaceId,
          conversationId,
          externalId: m.externalId,
          direction: (m.fromMe === true ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
          senderType: (m.fromMe === true ? 'system' : 'contact') as 'system' | 'contact',
          type: m.type ?? 'text',
          content: m.text ?? null,
          viewStatus: (m.fromMe === true ? 'sent' : 'delivered') as 'sent' | 'delivered',
          createdAt: toDate(m.timestamp),
          metadata: { origin: HISTORY_ORIGIN },
        }));
        messagesTotal += rows.length;

        const inserted = await tx
          .insert(schema.messages)
          .values(rows)
          .onConflictDoNothing({
            target: [schema.messages.conversationId, schema.messages.externalId],
          })
          .returning({ id: schema.messages.id });
        messagesInserted += inserted.length;

        if (inserted.length > 0) {
          const last = msgs[msgs.length - 1];
          if (last !== undefined) {
            await tx
              .update(schema.conversations)
              .set({
                lastMessagePreview: previewOf(last.text, last.type ?? 'text'),
                lastMessageAt: toDate(last.timestamp),
                lastMessageFrom: last.fromMe === true ? 'system' : 'contact',
                updatedAt: new Date(),
              })
              .where(eq(schema.conversations.id, conversationId));
          }
        }
      }

      return {
        resolved: true,
        contactsInserted,
        messagesInserted,
        messagesDeduped: messagesTotal - messagesInserted,
      };
    });
  }

  async syncAppState(payload: CoexistenceAppStatePayload): Promise<CoexistenceAppStateResult> {
    const channel = await this.channels.resolve(payload.phoneNumberId);
    if (channel === null) {
      this.logger.warn('coexistence: app_state sem canal para phoneNumberId — descartado', {
        phoneNumberId: payload.phoneNumberId,
      });
      return { resolved: false };
    }
    const { channelId, workspaceId } = channel;

    await withWorkspace(workspaceId, async (tx) => {
      const { channels } = schema;
      // Lê o metadata atual para fazer merge (sem clobber de outras chaves).
      const [row] = await tx
        .select({ metadata: channels.metadata })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);
      const current = row?.metadata ?? {};
      const nextMetadata: Record<string, unknown> = {
        ...current,
        coexistence: {
          state: payload.state,
          updatedAt: new Date().toISOString(),
        },
      };
      await tx
        .update(channels)
        .set({ metadata: nextMetadata, updatedAt: new Date() })
        .where(eq(channels.id, channelId));
    });

    return { resolved: true };
  }
}

/** Contraparte (waId/telefone) de uma mensagem histórica: `from` se recebida, `to` se enviada. */
function counterpartOf(msg: CoexistenceHistoryMessagePayload): string | null {
  const counterpart = msg.fromMe === true ? msg.to : msg.from;
  return typeof counterpart === 'string' && counterpart.length > 0 ? counterpart : null;
}

// ─── Upsert helpers (rodam DENTRO de withWorkspace) ───────────────────────────

/**
 * Garante o contato do `phone` (waId) dentro do workspace, casando por
 * `uq_contacts_workspace_phone`. Idempotente. Retorna o `contactId`.
 */
async function ensureContact(tx: DbTx, workspaceId: string, phone: string): Promise<string> {
  const { contacts } = schema;
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.phone, phone),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (existing !== undefined) return existing.id;

  const [created] = await tx
    .insert(contacts)
    .values({ workspaceId, phone, source: 'whatsapp' })
    .onConflictDoNothing({ target: [contacts.workspaceId, contacts.phone] })
    .returning({ id: contacts.id });
  if (created !== undefined) return created.id;

  // Conflito (inserido concorrentemente): reseleciona.
  const [row] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.phone, phone),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new Error('coexistence: contato não materializou após upsert.');
  }
  return row.id;
}

/**
 * Garante a conversa do par (canal, remoteId=phone). Upsert idempotente por
 * `uq_conversations_channel_remote (channel_id, remote_id)`. Retorna o
 * `conversationId`.
 */
async function ensureConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  remoteId: string,
  contactId: string,
): Promise<string> {
  const { conversations } = schema;
  const [existing] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (existing !== undefined) return existing.id;

  const [created] = await tx
    .insert(conversations)
    .values({
      workspaceId,
      channelId,
      contactId,
      remoteId,
      kind: 'direct',
      status: 'open',
      aiMode: 'off',
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({ id: conversations.id });
  if (created !== undefined) return created.id;

  const [row] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (row === undefined) {
    throw new Error('coexistence: conversa não materializou após upsert.');
  }
  return row.id;
}
