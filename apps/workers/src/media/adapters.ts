/**
 * Implementações default das portas do worker de mídia (F1-S10).
 *
 * Diferente de inbound/outbound, a persistência do UPDATE de mídia é
 * **direta** via `@hm/db` + `withWorkspace` (RLS) — sem MQ persist consumer. O
 * storage usa `@hm/storage` (R2/local pela env). Só o socket sai por MQ
 * (`hm.q.socket.relay`), como nos outros workers.
 *
 * Resolução de canal: lookup cross-tenant por `phone_number_id`/`ig_user_id`/
 * `waha_session_id` (índices únicos) com `getDb()` direto — é o passo que
 * descobre o tenant, então ainda não há `workspaceId` para escopar RLS (igual
 * ao DB-owner do inbound). A partir daí, toda query de mídia é `withWorkspace`.
 */
import { Buffer } from 'node:buffer';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Channel, IChannelAdapter } from '@hm/channels';
import { decryptSecret, getDb, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { ChannelProvider } from '@hm/shared';
import type { IStorageDriver } from '@hm/storage';
import type { MediaJobRoutingHints } from './job';
import type {
  MediaChannelResolver,
  MediaMessageTarget,
  MediaPersistencePort,
  MediaPersistInput,
  MediaReadyEmit,
  MediaSocketPort,
  MediaStoragePort,
  MediaUploadInput,
  ResolvedMediaChannel,
} from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

// ─── Channel resolver (DB) ────────────────────────────────────────────────────

/**
 * Fábrica de adapter por provider. É um ponto de composição (instanciar
 * `GraphClient`/`WahaClient` exige config de provider — base URLs, keys WAHA —
 * que pertence ao orquestrador, não a este worker), então é **injetada** na
 * composição (`createMediaDeps`/`startMediaWorker`). O default DB-backed só
 * resolve canal+token; quem monta o adapter HTTP é o caller.
 */
export type AdapterFactory = (provider: ChannelProvider) => IChannelAdapter;

/** Monta o snapshot `Channel` (token descifrado) a partir das linhas do DB. */
function toChannelSnapshot(
  row: typeof schema.channels.$inferSelect,
  accessToken: string,
): Channel {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider as ChannelProvider,
    accessToken,
    ...(row.phoneNumberId !== null ? { phoneNumberId: row.phoneNumberId } : {}),
    ...(row.wabaId !== null ? { wabaId: row.wabaId } : {}),
    ...(row.igUserId !== null ? { igUserId: row.igUserId } : {}),
    ...(row.fbPageId !== null ? { fbPageId: row.fbPageId } : {}),
  };
}

/** Coluna de identidade do canal por provider (casa com as routing hints). */
function routingFilter(provider: ChannelProvider, routing: MediaJobRoutingHints) {
  const { channels } = schema;
  switch (provider) {
    case 'meta_whatsapp':
      return routing.phoneNumberId !== undefined
        ? eq(channels.phoneNumberId, routing.phoneNumberId)
        : null;
    case 'meta_instagram':
      return routing.igUserId !== undefined ? eq(channels.igUserId, routing.igUserId) : null;
    case 'waha':
      return routing.wahaSession !== undefined
        ? eq(channels.wahaSessionId, routing.wahaSession)
        : null;
    default:
      return null;
  }
}

/**
 * Resolver default: descobre o canal (cross-tenant) pelas routing hints, decifra
 * o token e instancia o adapter. `getDb()` direto: é o passo que ainda não
 * conhece o tenant (igual ao DB-owner do inbound).
 */
export class DbMediaChannelResolver implements MediaChannelResolver {
  constructor(private readonly adapterFactory: AdapterFactory) {}

  async resolve(
    provider: ChannelProvider,
    routing: MediaJobRoutingHints,
  ): Promise<ResolvedMediaChannel | null> {
    const filter = routingFilter(provider, routing);
    if (filter === null) return null;

    const { channels, channelSecrets } = schema;
    const [row] = await getDb()
      .select({ channel: channels, secret: channelSecrets })
      .from(channels)
      .innerJoin(channelSecrets, eq(channelSecrets.channelId, channels.id))
      .where(and(eq(channels.provider, provider), eq(channels.isActive, true), filter))
      .limit(1);

    if (row === undefined) return null;

    const accessToken = decryptSecret(row.secret.accessTokenEnc, row.secret.keyVersion);
    return {
      channel: toChannelSnapshot(row.channel, accessToken),
      adapter: this.adapterFactory(provider),
      workspaceId: row.channel.workspaceId,
    };
  }
}

// ─── Storage (@hm/storage) ────────────────────────────────────────────────────

/** TTL das signed URLs de mídia (7 dias — a UI reidrata via REST se expirar). */
const MEDIA_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Storage default sobre `IStorageDriver`. `objectExists` é best-effort: o driver
 * não expõe `head`, então re-derivamos a signed URL (idempotente) e tratamos a
 * key como existente quando já temos registro dela (o dedup real vem do
 * `findKeyBySha256` na persistência). Subir o mesmo objeto duas vezes é seguro
 * (overwrite idêntico), então o "exists" só evita trabalho redundante.
 */
export class StorageMediaPort implements MediaStoragePort {
  constructor(
    private readonly driver: IStorageDriver,
    private readonly ttlSeconds: number = MEDIA_URL_TTL_SECONDS,
  ) {}

  async objectExists(_key: string): Promise<boolean> {
    // Sem HEAD no contrato do driver: confiamos no registro de `media_sha256`
    // (findKeyBySha256). Se chegou aqui com uma key, ela foi subida antes.
    await Promise.resolve();
    return true;
  }

  async upload(input: MediaUploadInput): Promise<void> {
    await this.driver.put({ key: input.key, body: input.body, contentType: input.contentType });
  }

  async publicUrl(key: string): Promise<string> {
    const signed = await this.driver.getSignedUrl(key, this.ttlSeconds);
    return signed.url;
  }
}

// ─── Persistence (@hm/db + withWorkspace, RLS) ────────────────────────────────

/** Chave em `messages.metadata` onde guardamos a key estável do objeto (dedup). */
const MEDIA_KEY_META = 'mediaKey' as const;

/**
 * Persistência default via `@hm/db`. Toda query roda dentro de
 * `withWorkspace(workspaceId, …)` → `SET LOCAL` de tenant + role `hm_app` (RLS).
 *
 * A key estável do objeto é guardada em `messages.metadata.mediaKey` (não há
 * coluna dedicada): permite reaproveitar a key num dedup por conteúdo, já que a
 * `media_url` é uma signed URL que expira.
 */
export class DbMediaPersistence implements MediaPersistencePort {
  async findMessage(workspaceId: string, externalId: string): Promise<MediaMessageTarget | null> {
    const { messages } = schema;
    return withWorkspace(workspaceId, async (tx) => {
      const [row] = await tx
        .select({
          messageId: messages.id,
          conversationId: messages.conversationId,
          mediaSha256: messages.mediaSha256,
        })
        .from(messages)
        .where(and(eq(messages.externalId, externalId), isNull(messages.deletedAt)))
        .limit(1);
      if (row === undefined) return null;
      return {
        messageId: row.messageId,
        conversationId: row.conversationId,
        existingSha256: row.mediaSha256,
      };
    });
  }

  async findKeyBySha256(workspaceId: string, sha256: string): Promise<string | null> {
    const { messages } = schema;
    return withWorkspace(workspaceId, async (tx) => {
      const [row] = await tx
        .select({ metadata: messages.metadata })
        .from(messages)
        .where(eq(messages.mediaSha256, sha256))
        .limit(1);
      const key = row?.metadata[MEDIA_KEY_META];
      return typeof key === 'string' && key.length > 0 ? key : null;
    });
  }

  async update(input: MediaPersistInput): Promise<void> {
    const { messages } = schema;
    await withWorkspace(input.workspaceId, async (tx) => {
      await tx
        .update(messages)
        .set({
          mediaUrl: input.mediaUrl,
          mediaMime: input.mediaMime,
          mediaSizeBytes: input.mediaSizeBytes,
          mediaSha256: input.mediaSha256,
          metadata: sql`${messages.metadata} || ${JSON.stringify({ [MEDIA_KEY_META]: input.mediaKey })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, input.messageId));
    });
  }
}

// ─── Socket (MQ relay) ────────────────────────────────────────────────────────

/**
 * Emissão de socket via fila de relay. Mesmo contrato de `relay.ts`:
 * `{ event, target: { conversationId }, data }` → room `conversation:{id}`.
 */
export class MqMediaSocketEmit implements MediaSocketPort {
  constructor(private readonly channel: MqChannel) {}

  async emitMediaReady(input: MediaReadyEmit): Promise<void> {
    const envelope = makeEnvelope('socket.relay', input.workspaceId, {
      event: 'message:media_ready',
      target: { conversationId: input.conversationId },
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        mediaUrl: input.mediaUrl,
      },
    });
    this.channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }
}
