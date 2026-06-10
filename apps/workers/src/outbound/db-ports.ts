/**
 * Persistência direta (`@hm/db` + `withWorkspace`/RLS) e resolução de canal do
 * worker outbound (F1-S26, ARCHITECTURE.md §4.2, LIVECHAT.md §3.1/§6).
 *
 * **Mudança de arquitetura (F1-S26).** Por ADR, o worker outbound também é dono
 * da persistência: o resultado do envio (`view_status`/`external_id`) é gravado
 * DIRETO via `@hm/db` (sem o publish fantasma `outbound.persist.requested →
 * consumer DB-owner`). Só o socket continua saindo por MQ (`hm.q.socket.relay`).
 *
 * `ChannelResolver` (default DB-backed) resolve o canal+token e instancia o
 * adapter via a `AdapterFactory` injetada (composição) — igual ao resolver de
 * mídia. Tudo atrás de portas injetáveis (testável sem DB/HTTP).
 */
import { eq } from 'drizzle-orm';
import type { Channel, IChannelAdapter } from '@hm/channels';
import { decryptSecret, schema, withWorkspace } from '@hm/db';
import type { ChannelProvider } from '@hm/shared';
import type {
  ChannelResolver,
  OutboundPersistencePort,
  PersistOutboundInput,
  ResolvedChannel,
} from './ports';

/**
 * Fábrica de adapter por provider + token. Recebe o snapshot `Channel` (token já
 * descifrado) e devolve o `IChannelAdapter` configurado. Injetada na composição
 * (`createOutboundDeps`/bootstrap) porque construir `GraphClient`/`WahaClient`
 * exige config de provider que pertence ao orquestrador.
 */
export type ChannelAdapterFactory = (channel: Channel) => IChannelAdapter;

/** Monta o snapshot `Channel` (token descifrado) a partir da linha do DB. */
export function toChannelSnapshot(
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

/**
 * Resolver default: carrega `channels` + `channel_secrets` por id (sob RLS do
 * workspace dono), decifra o token e instancia o adapter via a factory injetada.
 */
export class DbChannelResolver implements ChannelResolver {
  constructor(private readonly adapterFactory: ChannelAdapterFactory) {}

  async resolve(channelId: string, workspaceId: string): Promise<ResolvedChannel> {
    const { channels, channelSecrets } = schema;
    const row = await withWorkspace(workspaceId, async (tx) => {
      const [found] = await tx
        .select({ channel: channels, secret: channelSecrets })
        .from(channels)
        .innerJoin(channelSecrets, eq(channelSecrets.channelId, channels.id))
        .where(eq(channels.id, channelId))
        .limit(1);
      return found;
    });

    if (row === undefined) {
      throw new Error(`outbound: canal não encontrado (id=${channelId}).`);
    }

    const accessToken = decryptSecret(row.secret.accessTokenEnc, row.secret.keyVersion);
    const channel = toChannelSnapshot(row.channel, accessToken);
    return { channel, adapter: this.adapterFactory(channel) };
  }
}

/** Mapeia `failed_reason` curto a partir do erro do provider (best-effort). */
function failedReason(input: PersistOutboundInput): string | null {
  if (input.status !== 'failed') return null;
  return input.errorCode ?? 'outbound_send_failed';
}

/**
 * Persistência default do outbound via `@hm/db`. Sob `withWorkspace` (RLS):
 * UPDATE `messages.view_status`/`external_id`/`failed_reason` casando por id e
 * carimba `updated_at`. `typing_indicator` nunca chega aqui (filtrado em
 * `finalize.ts`).
 */
export class DbOutboundPersistence implements OutboundPersistencePort {
  async persist(input: PersistOutboundInput): Promise<void> {
    const { messages } = schema;
    const reason = failedReason(input);

    await withWorkspace(input.workspaceId, async (tx) => {
      await tx
        .update(messages)
        .set({
          viewStatus: input.status,
          ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
          ...(reason !== null ? { failedReason: reason } : {}),
          updatedAt: new Date(),
        })
        .where(eq(messages.id, input.messageId));
    });
  }
}
