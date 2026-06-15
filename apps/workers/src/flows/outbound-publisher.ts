/**
 * OutboundPublisher real do worker de flows (F31-S01).
 *
 * O ponto onde um flow finalmente ENVIA mensagem de verdade. Antes, a engine caia no
 * `noopPublisher` (sendMessage/sendPresence eram no-op em prod). Este publisher fecha a
 * ponte para o pipeline de envio existente, espelhando EXATAMENTE o composer da API
 * (`apps/api/src/mq/outbound-publisher.ts` + `routes/conversations/messages.ts`):
 *
 * ```
 * publishMessage(ws, msg)
 *   → resolve midia: storage.getSignedUrl(key, ttl) → publicMediaUrl   [IO fora da tx]
 *   → persiste message `pending` sob RLS (senderType=system) + resolve channelId/remoteId
 *   → publishOutboundJob(ws, job)  (shape exato de parseOutboundJob; kind text|media)
 * publishPresence(ws, action)
 *   → resolve channelId/remoteId + externalId da ultima inbound (alvo do indicador)
 *   → publishOutboundJob(ws, { kind:'typing_indicator', ... })  (no-op se sem alvo)
 * ```
 *
 * O `OutboundJob` viaja como `Record<string, unknown>` de proposito: a fonte da verdade do
 * shape e o `parseOutboundJob` (Zod) do worker outbound — qualquer divergencia falharia la
 * (nack sem requeue), entao o contrato e mantido em sincronia, mesma estrategia da API.
 *
 * Tudo injetavel (storage / persistencia RLS / publicacao MQ) para testabilidade sem
 * Postgres/RabbitMQ no loop; os defaults usam a infra real.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { connectMq, makeEnvelope, publish, QUEUES, type MqHandle } from '@hm/shared/mq';
import { schema, withWorkspace } from '@hm/db';
import { createStorage, type IStorageDriver } from '@hm/storage';
import type {
  FlowOutboundMediaKind,
  FlowOutboundMessage,
  FlowPresenceAction,
  OutboundPublisher,
} from '@hm/flow-engine';
import type { Logger } from '@hm/logger';

/** Tipo do envelope publicado (bind: `hm.q.outbound.#`), igual ao publisher da API. */
const OUTBOUND_JOB_TYPE = 'outbound.job' as const;
const OUTBOUND_ROUTING_KEY = `${QUEUES.outbound}.send`;

/** TTL da URL assinada de midia. O provider (Meta) precisa busca-la durante o envio. */
const DEFAULT_MEDIA_URL_TTL_SECONDS = 60 * 60;

// ── MQ: canal lazy singleton por processo (mesmo padrao do publisher da API) ──

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Publica um `OutboundJob` no exchange de eventos para `hm.q.outbound`. */
async function publishOutboundJob(workspaceId: string, job: Record<string, unknown>): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, workspaceId, job);
  return publish(channel, OUTBOUND_ROUTING_KEY, envelope);
}

/** Encerra o canal/conn (testes / shutdown). */
export async function closeFlowOutboundPublisher(): Promise<void> {
  if (!handlePromise) return;
  const pending = handlePromise;
  handlePromise = null;
  try {
    const { connection } = await pending;
    await connection.close();
  } catch {
    // ja caiu — nada a fazer
  }
}

// ── Persistencia RLS (injetavel; default usa @hm/db + withWorkspace) ──────────

export interface PersistOutboundMessageInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly type: string;
  readonly content: string | null;
  readonly mediaUrl: string | null;
  readonly mediaMime: string | null;
  readonly mediaCaption: string | null;
}

/** Canal+remoteId resolvidos da conversa + id da message persistida. */
export interface ResolvedOutboundTarget {
  readonly channelId: string;
  readonly remoteId: string;
  readonly messageId: string;
}

/** Canal+remoteId + alvo (externalId da ultima inbound) para indicador de presenca. */
export interface ResolvedPresenceTarget {
  readonly channelId: string;
  readonly remoteId: string;
  readonly targetExternalId: string | null;
}

/**
 * Porta de persistencia sob RLS. Default = Drizzle escopado por `withWorkspace`; os testes
 * injetam um fake (sem Postgres no loop), mantendo a engine de envio testavel.
 */
export interface OutboundPersistencePort {
  /**
   * Persiste a message `pending` (senderType=system) e resolve channelId/remoteId da
   * conversa, tudo na MESMA transacao RLS. `null` se a conversa nao existe no tenant.
   */
  persistOutboundMessage(input: PersistOutboundMessageInput): Promise<ResolvedOutboundTarget | null>;
  /** Resolve channelId/remoteId + externalId da ultima inbound (alvo do indicador). */
  resolvePresenceTarget(input: {
    workspaceId: string;
    conversationId: string;
  }): Promise<ResolvedPresenceTarget | null>;
}

/** Implementacao real: espelha `messages.ts` (insert pending) sob RLS. */
export function createDbOutboundPersistence(): OutboundPersistencePort {
  return {
    async persistOutboundMessage(input) {
      return withWorkspace(input.workspaceId, async (tx) => {
        const [conv] = await tx
          .select({
            channelId: schema.conversations.channelId,
            remoteId: schema.conversations.remoteId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, input.conversationId))
          .limit(1);
        if (!conv) return null;

        const [row] = await tx
          .insert(schema.messages)
          .values({
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            direction: 'outbound',
            // Flow e autoridade do sistema (nao ha membro humano por tras do envio).
            senderType: 'system',
            type: input.type,
            content: input.content,
            viewStatus: 'pending',
            externalId: null,
            mediaUrl: input.mediaUrl,
            mediaMime: input.mediaMime,
            mediaCaption: input.mediaCaption,
          })
          .returning({ id: schema.messages.id });
        if (!row) return null;

        return { channelId: conv.channelId, remoteId: conv.remoteId, messageId: row.id };
      });
    },

    async resolvePresenceTarget(input) {
      return withWorkspace(input.workspaceId, async (tx) => {
        const [conv] = await tx
          .select({
            channelId: schema.conversations.channelId,
            remoteId: schema.conversations.remoteId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, input.conversationId))
          .limit(1);
        if (!conv) return null;

        const [lastInbound] = await tx
          .select({ externalId: schema.messages.externalId })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, input.conversationId),
              eq(schema.messages.direction, 'inbound'),
              isNotNull(schema.messages.externalId),
            ),
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(1);

        return {
          channelId: conv.channelId,
          remoteId: conv.remoteId,
          targetExternalId: lastInbound?.externalId ?? null,
        };
      });
    },
  };
}

// ── Resolucao de tipo de midia ────────────────────────────────────────────────

/** Deriva o `mediaKind` da mensagem (explicito > audio > MIME). */
function resolveOutboundKind(message: FlowOutboundMessage): 'text' | FlowOutboundMediaKind {
  if (message.audioMessageKind) {
    // nota de voz vs arquivo de audio encaminhado (LIVECHAT.md §4).
    return message.audioMessageKind === 'voice' ? 'voice' : 'audio';
  }
  if (message.mediaStorageKey) {
    return message.mediaKind ?? mediaKindFromMime(message.mediaType);
  }
  return 'text';
}

/** Fallback: deriva o kind do prefixo MIME quando nao ha kind explicito. */
function mediaKindFromMime(mime: string | undefined): FlowOutboundMediaKind {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── Publisher ─────────────────────────────────────────────────────────────────

export interface OutboundPublisherDeps {
  readonly logger: Logger;
  /** Driver de storage (default: por env via `createStorage`). */
  readonly storage?: IStorageDriver;
  /** Persistencia RLS (default: Drizzle via `withWorkspace`). */
  readonly persistence?: OutboundPersistencePort;
  /** Publicacao do envelope (default: RabbitMQ real). Injetavel nos testes. */
  readonly publishJob?: (workspaceId: string, job: Record<string, unknown>) => Promise<boolean>;
  /** TTL (s) da URL assinada de midia (default 1h). */
  readonly mediaUrlTtlSeconds?: number;
}

/**
 * Constroi o `OutboundPublisher` real consumido pelo `createOutboundPort` da engine.
 * Degradacao conservadora: input incompleto/conversa invisivel/sem alvo de presenca
 * vira no-op logado (warn) — nunca derruba o step do flow nem enfileira job invalido.
 */
export function createOutboundPublisher(deps: OutboundPublisherDeps): OutboundPublisher {
  const { logger } = deps;
  const storage = deps.storage ?? createStorage();
  const persistence = deps.persistence ?? createDbOutboundPersistence();
  const publishJob = deps.publishJob ?? publishOutboundJob;
  const ttl = deps.mediaUrlTtlSeconds ?? DEFAULT_MEDIA_URL_TTL_SECONDS;

  return {
    async publishMessage(workspaceId, message) {
      // interactive/meta_flow/external_notify ainda nao tem traducao para OutboundJob
      // (payloads ricos != InteractivePayloadSchema do worker). Degradacao conservadora:
      // no-op logado, preservando o comportamento anterior (era no-op) sem enfileirar
      // job que falharia o parseOutboundJob. Ver REPORT (follow-up).
      if (message.interactivePayload) {
        logger.warn('flow-outbound: interactivePayload sem bridge — no-op', {
          conversationId: message.conversationId,
        });
        return;
      }

      const kind = resolveOutboundKind(message);

      if (kind === 'text') {
        const text = message.text?.trim();
        if (!text) {
          logger.warn('flow-outbound: texto vazio descartado', {
            conversationId: message.conversationId,
          });
          return;
        }
        const target = await persistence.persistOutboundMessage({
          workspaceId,
          conversationId: message.conversationId,
          type: 'text',
          content: text,
          mediaUrl: null,
          mediaMime: null,
          mediaCaption: null,
        });
        if (!target) {
          logger.warn('flow-outbound: conversa inexistente/invisivel — no-op', {
            conversationId: message.conversationId,
          });
          return;
        }
        await publishJob(workspaceId, {
          kind: 'text',
          channelId: target.channelId,
          conversationId: message.conversationId,
          messageId: target.messageId,
          chatId: target.remoteId,
          text,
        });
        return;
      }

      // ── midia (imagem/video/audio/voz/documento) ──
      if (!message.mediaStorageKey) {
        logger.warn('flow-outbound: midia sem mediaStorageKey — descartada', {
          conversationId: message.conversationId,
          kind,
        });
        return;
      }
      const mime = message.mediaType?.trim();
      if (!mime) {
        logger.warn('flow-outbound: midia sem mediaType (MIME) — descartada', {
          conversationId: message.conversationId,
          kind,
        });
        return;
      }

      // Resolve a URL publica temporaria FORA da transacao (IO de storage).
      const signed = await storage.getSignedUrl(message.mediaStorageKey, ttl);
      const publicMediaUrl = signed.url;

      const rawCaption = message.caption ?? message.text;
      const caption = rawCaption && rawCaption.trim().length > 0 ? rawCaption.trim() : undefined;

      const target = await persistence.persistOutboundMessage({
        workspaceId,
        conversationId: message.conversationId,
        type: kind,
        content: caption ?? null,
        mediaUrl: publicMediaUrl,
        mediaMime: mime,
        mediaCaption: caption ?? null,
      });
      if (!target) {
        logger.warn('flow-outbound: conversa inexistente/invisivel — no-op', {
          conversationId: message.conversationId,
        });
        return;
      }

      await publishJob(workspaceId, {
        kind: 'media',
        channelId: target.channelId,
        conversationId: message.conversationId,
        messageId: target.messageId,
        chatId: target.remoteId,
        mediaKind: kind,
        publicMediaUrl,
        mime,
        ...(caption ? { caption } : {}),
      });
    },

    async publishPresence(workspaceId, action: FlowPresenceAction) {
      const target = await persistence.resolvePresenceTarget({
        workspaceId,
        conversationId: action.conversationId,
      });
      if (!target) {
        logger.warn('flow-outbound: presenca para conversa inexistente — no-op', {
          conversationId: action.conversationId,
        });
        return;
      }
      // Sem inbound enderecavel nao ha alvo do indicador. Degradacao conservadora:
      // no-op silencioso (presenca e cosmetica; nunca deve enfileirar job invalido).
      if (!target.targetExternalId) {
        logger.debug('flow-outbound: presenca sem inbound alvo — no-op', {
          conversationId: action.conversationId,
        });
        return;
      }
      await publishJob(workspaceId, {
        kind: 'typing_indicator',
        channelId: target.channelId,
        conversationId: action.conversationId,
        // typing_indicator nao persiste message (finalize o ignora); messageId e so
        // correlacao do envelope — sintetico, mas obrigatorio (base.messageId min(1)).
        messageId: `presence:${randomUUID()}`,
        chatId: target.remoteId,
        targetExternalId: target.targetExternalId,
        presence: action.presence,
      });
    },
  };
}
