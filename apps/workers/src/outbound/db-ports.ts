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
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Channel, IChannelAdapter } from '@hm/channels';
import { decryptSecret, schema, withWorkspace } from '@hm/db';
import type { ChannelProvider } from '@hm/shared';
import { nextViewStatus } from '../inbound/status';
import type { RecordAttemptInput, SendAttemptStore } from './retry-policy';
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
 * Preview curto da última mensagem outbound (texto truncado ou rótulo do tipo).
 * Espelha exatamente a convenção do inbound (`previewOf`): `[audio]`, `[image]`…
 */
function outboundPreview(content: string | null, type: string): string {
  const trimmed = content?.trim();
  if (trimmed) return trimmed.slice(0, 280);
  return `[${type}]`;
}

// ─── Idempotency guard (F52-S04) ──────────────────────────────────────────────

/** True quando há `DATABASE_URL` — fora disso (testes unit puros) o guard no-opa. */
function dbConfigured(): boolean {
  const url = process.env['DATABASE_URL'];
  return typeof url === 'string' && url.length > 0;
}

/**
 * Guard de idempotência de envio (F52-S04). Antes de chamar o adapter, o
 * `dispatch` pergunta se a mensagem JÁ tem `external_id` persistido — se tiver, o
 * job já foi entregue ao provider numa execução anterior (redelivery após crash
 * parcial) e NÃO deve reenviar (evita 2 wamids / cobrança dupla). A idempotência
 * forte é o `external_id` presente; o índice único `uq_messages_outbound_idempotency_key`
 * + a chave gravada na borda (`messages.ts`) cobrem o duplo-POST do cliente.
 */
export interface OutboundSendGuard {
  /** `external_id` já persistido para a mensagem, ou `null` (ainda não enviada). */
  findSentExternalId(messageId: string, workspaceId: string): Promise<string | null>;
}

/** Guard default `@hm/db`+RLS. No-opa (retorna `null`) sem `DATABASE_URL`. */
export class DbOutboundSendGuard implements OutboundSendGuard {
  async findSentExternalId(messageId: string, workspaceId: string): Promise<string | null> {
    if (!dbConfigured()) return null;
    const { messages } = schema;
    return withWorkspace(workspaceId, async (tx) => {
      const [row] = await tx
        .select({ externalId: messages.externalId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      return row?.externalId ?? null;
    });
  }
}

/** Instância default compartilhada (injetada por padrão em `dispatchOutbound`). */
export const defaultOutboundSendGuard: OutboundSendGuard = new DbOutboundSendGuard();

// ─── Contador durável de tentativas de envio (F56-S14) ────────────────────────

/** Teto de caracteres do erro guardado em `metadata.lastSendError.message`. */
const LAST_ERROR_MAX_LEN = 500;

/**
 * Contador de tentativas de envio persistido em `messages.metadata` (F56-S14).
 *
 * **Por que no Postgres.** O retry é durável (ladder do broker sobrevive a
 * restart do worker); o contador precisa ser igualmente durável, senão um
 * restart no meio do backoff zeraria a contagem e a mensagem retentaria para
 * sempre. Um contador em memória (ou em Redis, que é cache) não dá essa
 * garantia. Bônus: o suporte VÊ, na própria mensagem, quantas tentativas houve e
 * qual foi o último erro do provider.
 *
 * O incremento é feito no banco (`metadata || jsonb_build_object(...)` com o
 * valor lido da própria linha) e retorna o total já gravado — sem read-modify-
 * write na aplicação. O lock por conversa serializa os envios da mesma conversa;
 * o `RETURNING` mantém a contagem correta de qualquer forma.
 *
 * Sem `DATABASE_URL` (unit tests puros) no-opa devolvendo `1` (= "primeira
 * tentativa") — nunca dispara o terminal `failed` por acidente.
 */
export class DbSendAttemptStore implements SendAttemptStore {
  async record(input: RecordAttemptInput): Promise<number> {
    if (!dbConfigured()) return 1;
    const { messages } = schema;

    const lastError = JSON.stringify({
      code: input.failure.errorCode,
      message: input.failure.errorMessage.slice(0, LAST_ERROR_MAX_LEN),
      at: new Date().toISOString(),
    });

    const rows = await withWorkspace(input.workspaceId, async (tx) =>
      tx
        .update(messages)
        .set({
          metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || jsonb_build_object(
            'sendAttempts', coalesce((${messages.metadata} ->> 'sendAttempts')::int, 0) + 1,
            'lastSendError', ${lastError}::jsonb
          )`,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, input.messageId))
        .returning({ metadata: messages.metadata }),
    );

    return readSendAttempts(rows[0]?.metadata);
  }
}

/** Lê `metadata.sendAttempts` com narrowing (default 1 = primeira tentativa). */
function readSendAttempts(metadata: Record<string, unknown> | undefined): number {
  const raw = metadata?.['sendAttempts'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Instância default compartilhada (injetada por padrão no worker outbound). */
export const defaultSendAttemptStore: SendAttemptStore = new DbSendAttemptStore();

/**
 * Persistência default do outbound via `@hm/db`. Sob `withWorkspace` (RLS):
 * UPDATE `messages.view_status`/`external_id`/`failed_reason` casando por id e
 * carimba `updated_at`. `typing_indicator` nunca chega aqui (filtrado em
 * `finalize.ts`).
 */
export class DbOutboundPersistence implements OutboundPersistencePort {
  async persist(input: PersistOutboundInput): Promise<void> {
    const { messages, conversations } = schema;
    const reason = failedReason(input);

    await withWorkspace(input.workspaceId, async (tx) => {
      const [current] = await tx
        .select({
          id: messages.id,
          viewStatus: messages.viewStatus,
          content: messages.content,
          type: messages.type,
          senderType: messages.senderType,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.id, input.messageId))
        .limit(1);
      if (current === undefined) return;

      // Monotônico (F52-S04): só avança o view_status (sent<delivered<read;
      // failed vence). Garante que redelivery de job e reconciliação de órfão
      // NUNCA regridem o status (ex.: re-gravar `sent` numa msg já `read`).
      const advanced = nextViewStatus(current.viewStatus, input.status);

      await tx
        .update(messages)
        .set({
          // SEMPRE grava o external_id quando presente, mesmo sem avanço de
          // status — assim o callback de status passa a casar a mensagem (fecha
          // a janela do órfão na origem).
          ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
          ...(advanced !== null
            ? { viewStatus: advanced, ...(reason !== null ? { failedReason: reason } : {}) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(messages.id, current.id));

      // Realtime da ChatList (paridade com o inbound `bumpConversation`): ao ENVIAR
      // (status 'sent'), bumpa `conversation.last_message_*` para a lista reordenar
      // e atualizar o preview ao vivo. Antes, NENHUM caminho outbound (operador/IA/
      // sistema/flow) bumpava → a conversa não subia e o preview ficava no último
      // inbound. Outbound NÃO mexe em `unread_count`. Monotônico: o `or(isNull, lte)`
      // evita regredir a ordenação se uma mensagem mais nova já bumpou a conversa
      // (redelivery / corrida de finalize). `senderType` ∈ domínio de `last_message_from`.
      if (input.status === 'sent') {
        await tx
          .update(conversations)
          .set({
            lastMessageId: current.id,
            lastMessagePreview: outboundPreview(current.content, current.type),
            lastMessageAt: current.createdAt,
            lastMessageFrom: current.senderType,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(conversations.id, input.conversationId),
              or(
                isNull(conversations.lastMessageAt),
                lte(conversations.lastMessageAt, current.createdAt),
              ),
            ),
          );
      }
    });
  }
}
