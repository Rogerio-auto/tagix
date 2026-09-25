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
 *   **outbound**, deduplicada por `uq_messages_external (conversation_id,
 *   external_id)` (`onConflictDoNothing`). F70-S04: o eco é resposta HUMANA —
 *   `sender_type='member'` com o dono do canal como autor, `metadata.origin='app'`,
 *   pausa a IA (`human_takeover`, mesma regra da UI), marca `first_response_at`
 *   e, quando abre a conversa (prospecção), nasce com IA desligada e etiqueta o
 *   contato com `origem:prospeccao`. O eco do Instagram (`persistInstagramEcho`)
 *   passa pelo MESMO núcleo (`persistAppEcho`).
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
import { Buffer } from 'node:buffer';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type {
  ConversationAiModeChangedPayload,
  ConversationOriginValue,
  ServerToClientEvent,
} from '@hm/shared';
import { buildMessageNewPayload, planHumanReply, previewFor } from '@hm/shared';
import type {
  CoexistenceAppStatePayload,
  CoexistenceEchoPayload,
  CoexistenceHistoryBatchPayload,
  CoexistenceHistoryMessagePayload,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type { MediaRef } from '@hm/channels';
import type {
  CoexistenceAppStateResult,
  CoexistenceEchoResult,
  CoexistenceHistoryResult,
  CoexistenceMessageNewEmit,
  CoexistencePersistencePort,
  CoexistenceSocketPort,
} from './ports';
import type { InboundMediaJob, MediaEnqueuePort, RoutingHints } from '../inbound/ports';
import { applyOriginTag } from '../inbound/origin';
import type { InstagramEchoInput } from './instagram-echo';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Provider dos canais de coexistência (WhatsApp Business / WABA). */
const COEXISTENCE_PROVIDER = 'meta_whatsapp' as const;

/**
 * Origem gravada em `messages.metadata.origin`. `app` (F70-S04; antes
 * `coexistence_echo`): a mensagem foi escrita por um humano no app do celular
 * (WhatsApp Business ou Instagram), não pela UI do Leadium. `echoSource` diz qual.
 */
const APP_ORIGIN = 'app' as const;
const HISTORY_ORIGIN = 'coexistence_history' as const;

/** Etiqueta aplicada ao contato quando o dono abre a conversa pelo app (prospecção). */
export const PROSPECTION_TAG_NAME = 'origem:prospeccao' as const satisfies ConversationOriginValue;

/**
 * Origem das conversas criadas pelo import de HISTÓRICO (F70-S07): são exatamente
 * os contatos antigos do número (família, clientes de antes do Leadium). Nada
 * comprova de onde vieram, então nascem `sem-origem` — e a IA nunca os atende
 * sozinha. Um humano ainda pode ligar a IA manualmente numa delas.
 */
const HISTORY_CONVERSATION_ORIGIN = 'sem-origem' as const satisfies ConversationOriginValue;

/**
 * Chave opcional em `channels.metadata` que aponta o membro dono do número
 * (quem responde pelo celular). Ver `resolveChannelOwner`.
 */
export const CHANNEL_OWNER_METADATA_KEY = 'ownerMemberId' as const;

/** Resultado de eco que não chegou a ser persistido. */
const UNRESOLVED_ECHO = {
  resolved: false,
  inserted: false,
  aiPaused: false,
  startedByApp: false,
} as const satisfies CoexistenceEchoResult;

/** Entrada normalizada do núcleo comum de ecos (WhatsApp + Instagram). */
interface AppEchoInput {
  readonly provider: 'meta_whatsapp' | 'meta_instagram';
  readonly channel: ResolvedCoexistenceChannel;
  /** `remote_id` da conversa: telefone (WA) ou IGSID (IG) do contato. */
  readonly remoteId: string;
  readonly contactSource: 'whatsapp' | 'instagram';
  readonly echoSource: 'whatsapp_coexistence' | 'instagram_echo';
  readonly externalId: string;
  readonly type: string;
  readonly content: string | null;
  readonly occurredAt: Date;
  readonly mediaRef: MediaRef | undefined;
  readonly routing: RoutingHints;
}

/** Tipos de mensagem que carregam mídia baixável (`raw[type].id`). */
const MEDIA_ECHO_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);

/**
 * Extrai a `MediaRef` do objeto cru da mensagem ecoada — MESMO shape do inbound
 * (`webhook.parser.extractMediaRef`): `raw[type] = { id, mime_type, sha256, filename }`.
 *
 * Por que isto existe (F39 gap): o echo da coexistência gravava só `type`+`text`,
 * sem `media_url`/`media_status` → a mídia que o operador envia pelo app WhatsApp
 * aparecia como "Não foi possível carregar" no chat. Com a ref, o echo persiste
 * `media_status='pending'` e enfileira o MESMO job do inbound (`hm.q.media`); o
 * media-worker baixa do Meta → R2 → seta `media_url`/`ready`. Retorna `undefined`
 * quando não há mídia/id (caller não marca pending nem enfileira).
 */
function extractEchoMediaRef(raw: Record<string, unknown>, type: string): MediaRef | undefined {
  if (!MEDIA_ECHO_TYPES.has(type)) return undefined;
  const obj = raw[type];
  if (obj === null || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const id = typeof o['id'] === 'string' ? o['id'] : undefined;
  if (id === undefined || id.length === 0) return undefined;
  const mimeType = typeof o['mime_type'] === 'string' ? o['mime_type'] : undefined;
  const sha256 = typeof o['sha256'] === 'string' ? o['sha256'] : undefined;
  const fileName = typeof o['filename'] === 'string' ? o['filename'] : undefined;
  return {
    refOrUrl: id,
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(sha256 !== undefined ? { sha256 } : {}),
    ...(fileName !== undefined ? { fileName } : {}),
  };
}

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
  /** Canal Instagram ativo pelo `ig_user_id` (`uq_channels_ig_user_id`). */
  resolveInstagram(igUserId: string): Promise<ResolvedCoexistenceChannel | null>;
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

  async resolveInstagram(igUserId: string): Promise<ResolvedCoexistenceChannel | null> {
    const { channels } = schema;
    const [row] = await getDb()
      .select({ id: channels.id, workspaceId: channels.workspaceId })
      .from(channels)
      .where(
        and(
          eq(channels.provider, 'meta_instagram'),
          eq(channels.isActive, true),
          eq(channels.igUserId, igUserId),
        ),
      )
      .limit(1);
    return row === undefined ? null : { channelId: row.id, workspaceId: row.workspaceId };
  }
}

// ─── Socket (MQ relay) ────────────────────────────────────────────────────────

/** Publica `{ event, target:{conversationId, workspace:true}, data }` no relay. */
function relayEnvelope(
  channel: MqChannel,
  workspaceId: string,
  event: ServerToClientEvent,
  conversationId: string,
  data: unknown,
): void {
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event,
    target: { conversationId, workspace: true },
    data,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/**
 * Emissor default de socket da coexistência: publica `message:new` no relay com
 * `workspace: true` (espelha `MqInboundSocketEmit` do inbound). Mesma forma de
 * payload do inbound para o front reagir igual (ChatList + thread aberta).
 */
export class MqCoexistenceSocketEmit implements CoexistenceSocketPort {
  constructor(private readonly channel: MqChannel) {}

  async emitMessageNew(input: CoexistenceMessageNewEmit): Promise<void> {
    // F61-S13: `origin: 'coexistence'` — sincronização não é lead chegando. O remetente
    // espelha o que a coexistência grava (F70-S04: `member` para o eco do app).
    relayEnvelope(
      this.channel,
      input.workspaceId,
      'message:new',
      input.conversationId,
      buildMessageNewPayload({
        workspaceId: input.workspaceId,
        message: {
          id: input.messageId,
          conversationId: input.conversationId,
          externalId: input.externalId,
          type: input.type,
          content: input.content,
          direction: input.direction,
          senderType: input.senderType,
          origin: 'coexistence',
        },
      }),
    );
    await Promise.resolve();
  }

  async emitAiModeChanged(
    workspaceId: string,
    conversationId: string,
    aiMode: 'paused',
  ): Promise<void> {
    // Mesmo payload da rota de envio da API (F30-S04) — o cockpit já reage a ele.
    const data: ConversationAiModeChangedPayload = {
      conversationId,
      aiMode,
      reason: 'human_takeover',
    };
    relayEnvelope(this.channel, workspaceId, 'conversation:ai_mode_changed', conversationId, data);
    await Promise.resolve();
  }

  async emitConversationUpdated(workspaceId: string, conversationId: string): Promise<void> {
    relayEnvelope(this.channel, workspaceId, 'conversation:updated', conversationId, {
      workspaceId,
      conversation: { id: conversationId },
    });
    await Promise.resolve();
  }
}

/**
 * Emissor no-op: usado quando não há canal AMQP (testes) ou quando o relay não é
 * desejado. Mantém a persistência funcional sem emitir nada.
 */
export class NoopCoexistenceSocketEmit implements CoexistenceSocketPort {
  async emitMessageNew(): Promise<void> {
    await Promise.resolve();
  }

  async emitConversationUpdated(): Promise<void> {
    await Promise.resolve();
  }

  async emitAiModeChanged(): Promise<void> {
    await Promise.resolve();
  }
}

function toDate(timestamp: number | undefined): Date {
  if (timestamp === undefined) return new Date();
  // Webhooks WhatsApp expõem epoch em segundos; tolera milissegundos.
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** ISO-8601 (horário do provider) → Date; inválido cai no relógio local. */
function isoToDate(iso: string): Date {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** F61-S12: regra única em `@hm/shared` (antes emitia `[${type}]` cru). */
function previewOf(text: string | undefined, type: string): string {
  return previewFor(type, text ?? null);
}

/**
 * Persistência default do worker de coexistência via `@hm/db`. Resolve
 * channel→workspace e aplica todo o trecho DB-bound sob RLS.
 */
export class DbCoexistencePersistence implements CoexistencePersistencePort {
  constructor(
    private readonly logger: Logger,
    private readonly channels: CoexistenceChannelResolver = new DbCoexistenceChannelResolver(),
    /**
     * Emissor de socket (`message:new`). Default no-op para manter os testes (que
     * instanciam só com `logger`) e o caminho sem broker funcionais; o composition
     * root injeta `MqCoexistenceSocketEmit(channel)` para empurrar ao vivo.
     */
    private readonly socket: CoexistenceSocketPort = new NoopCoexistenceSocketEmit(),
    /**
     * Enfileiramento de mídia (reusa `hm.q.media` do inbound). Default `undefined`
     * (testes/sem broker) → não enfileira; o composition root injeta `MqMediaEnqueue`
     * quando há canal AMQP. A persistência da mensagem nunca depende disto.
     */
    private readonly media?: MediaEnqueuePort,
    /**
     * IDs dos apps Meta que são o próprio Leadium (env `META_APP_ID`). Eco do IG
     * com `app_id` nesta lista é mensagem que nós mesmos enviamos pela API — não
     * é resposta humana e é ignorado. Vazio = sem filtro (só o dedup por mid).
     */
    private readonly ownMetaAppIds: ReadonlySet<string> = new Set(),
  ) {}

  async persistEcho(payload: CoexistenceEchoPayload): Promise<CoexistenceEchoResult> {
    const channel = await this.channels.resolve(payload.phoneNumberId);
    if (channel === null) {
      this.logger.warn('coexistence: echo sem canal para phoneNumberId — descartado', {
        phoneNumberId: payload.phoneNumberId,
      });
      return UNRESOLVED_ECHO;
    }

    return this.persistAppEcho({
      provider: COEXISTENCE_PROVIDER,
      channel,
      remoteId: payload.to,
      contactSource: 'whatsapp',
      echoSource: 'whatsapp_coexistence',
      externalId: payload.externalId,
      type: payload.type,
      content: payload.text ?? null,
      occurredAt: toDate(payload.timestamp),
      // Mídia ecoada: extrai a ref do raw p/ baixar igual ao inbound (senão a bolha
      // fica sem media_url e o chat mostra "Não foi possível carregar").
      mediaRef: extractEchoMediaRef(payload.raw, payload.type),
      routing: { phoneNumberId: payload.phoneNumberId },
    });
  }

  async persistInstagramEcho(echo: InstagramEchoInput): Promise<CoexistenceEchoResult> {
    const channel = await this.channels.resolveInstagram(echo.igUserId);
    if (channel === null) {
      this.logger.warn('coexistence: eco IG sem canal para igUserId — descartado', {
        igUserId: echo.igUserId,
      });
      return UNRESOLVED_ECHO;
    }

    // O IG ecoa TUDO que a conta envia, inclusive o que o próprio Leadium mandou
    // pela API (resposta da IA, flow, atendente pela UI). Esse eco não é resposta
    // humana pelo app: tratá-lo como tal pausaria a IA a cada mensagem dela. O
    // dedup por mid cobre o caso comum (o outbound já gravou o mid), mas não a
    // corrida em que o eco chega antes do worker outbound gravar o mid — o
    // `app_id` do nosso app fecha essa janela.
    if (echo.appId !== undefined && this.ownMetaAppIds.has(echo.appId)) {
      this.logger.debug('coexistence: eco IG do próprio app — ignorado', {
        externalId: echo.externalId,
      });
      return { ...UNRESOLVED_ECHO, resolved: true, skipped: 'own_app' };
    }

    return this.persistAppEcho({
      provider: 'meta_instagram',
      channel,
      remoteId: echo.contactRemoteId,
      contactSource: 'instagram',
      echoSource: 'instagram_echo',
      externalId: echo.externalId,
      type: echo.messageType,
      content: echo.content ?? null,
      occurredAt: isoToDate(echo.rawTimestamp),
      mediaRef: echo.mediaRef,
      routing: { igUserId: echo.igUserId },
    });
  }

  /**
   * Núcleo comum dos ecos (WhatsApp coexistência + Instagram), F70-S04.
   *
   * Numa única transação RLS: contato → conversa → autor (dono do canal) →
   * mensagem `member` (dedup por id externo) → e, só se inseriu de fato, a regra
   * de resposta humana na conversa (pausa da IA / primeira resposta) e, se o eco
   * abriu a conversa, a marca de prospecção. Reentrega do mesmo eco é no-op
   * completo: não reinsere, não repausa, não reetiqueta, não reemite.
   */
  private async persistAppEcho(input: AppEchoInput): Promise<CoexistenceEchoResult> {
    const { channelId, workspaceId } = input.channel;

    const result = await withWorkspace(workspaceId, async (tx) => {
      const contactId = await ensureContact(tx, workspaceId, input.remoteId, input.contactSource);
      // Se este eco abrir a conversa, o dono chamou primeiro: prospecção (F70-S04).
      // A origem é gravada no INSERT (F70-S07), então a trava da IA vale desde já.
      const conversation = await ensureConversation(
        tx,
        workspaceId,
        channelId,
        input.remoteId,
        contactId,
        PROSPECTION_TAG_NAME,
      );
      const ownerMemberId = await resolveChannelOwner(tx, workspaceId, channelId);

      const [inserted] = await tx
        .insert(schema.messages)
        .values({
          workspaceId,
          conversationId: conversation.id,
          externalId: input.externalId,
          direction: 'outbound',
          senderType: 'member',
          senderMemberId: ownerMemberId,
          type: input.type,
          content: input.content,
          viewStatus: 'sent',
          createdAt: input.occurredAt,
          metadata: { origin: APP_ORIGIN, echoSource: input.echoSource },
          // Mídia nasce 'pending' (espelha o inbound); o media-worker baixa e seta
          // media_url + 'ready'. Sem ref, fica null (mensagem de texto/sem mídia).
          ...(input.mediaRef !== undefined ? { mediaStatus: 'pending' as const } : {}),
        })
        .onConflictDoNothing({
          target: [schema.messages.conversationId, schema.messages.externalId],
          where: sql`${schema.messages.externalId} is not null`,
        })
        .returning({ id: schema.messages.id });

      if (inserted === undefined) {
        return {
          conversationId: conversation.id,
          messageId: undefined,
          aiPaused: false,
          startedByApp: false,
        };
      }

      // Estado atual sob lock de linha: serializa ecos concorrentes da mesma
      // conversa (e a rota de envio da UI), para a transição on→paused acontecer
      // uma vez só e `first_response_at` não ser disputado.
      const { conversations } = schema;
      const [state] = await tx
        .select({
          aiMode: conversations.aiMode,
          firstResponseAt: conversations.firstResponseAt,
          aiLastHumanAt: conversations.aiLastHumanAt,
        })
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
        .for('update')
        .limit(1);

      // Conversa aberta por este eco = o dono chamou primeiro (prospecção). Ela
      // já nasce com `ai_mode='off'` (ensureConversation) e não conta primeira
      // resposta — ninguém perguntou nada ainda.
      const startedByApp = conversation.created;
      const plan = planHumanReply(
        {
          aiMode: state?.aiMode ?? 'off',
          firstResponseAt: state?.firstResponseAt ?? null,
          aiLastHumanAt: state?.aiLastHumanAt ?? null,
        },
        { memberId: ownerMemberId, at: input.occurredAt, countsAsResponse: !startedByApp },
      );

      await tx
        .update(conversations)
        .set({
          ...plan.patch,
          ...(startedByApp ? { aiMode: 'off' as const } : {}),
          lastMessagePreview: previewOf(input.content ?? undefined, input.type),
          lastMessageAt: input.occurredAt,
          lastMessageFrom: 'member',
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversation.id));

      if (startedByApp) {
        await applyOriginTag(tx, workspaceId, contactId, PROSPECTION_TAG_NAME, ownerMemberId);
      }

      return {
        conversationId: conversation.id,
        messageId: inserted.id,
        aiPaused: plan.paused,
        startedByApp,
      };
    });

    // Pós-persist (fora da transação): empurra o echo ao vivo. Só quando inseriu
    // de fato (dedup não reemite — espelha `insertMessages` do inbound).
    if (result.messageId !== undefined) {
      await this.socket.emitMessageNew({
        workspaceId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        externalId: input.externalId,
        type: input.type,
        content: input.content,
        direction: 'outbound',
        senderType: 'member',
      });
      this.logger.info('coexistence: eco do app materializado como resposta humana', {
        workspaceId,
        conversationId: result.conversationId,
        echoSource: input.echoSource,
        aiPaused: result.aiPaused,
        startedByApp: result.startedByApp,
      });
    }

    if (result.aiPaused) {
      await this.socket.emitAiModeChanged(workspaceId, result.conversationId, 'paused');
    }

    // Enfileira o download DEPOIS de persistir (a linha precisa existir antes — o
    // media-worker casa por externalId). Só quando inseriu de fato + há mídia.
    if (result.messageId !== undefined && input.mediaRef !== undefined) {
      await this.media?.enqueue({
        provider: input.provider,
        externalId: input.externalId,
        mediaRef: input.mediaRef,
        routing: input.routing,
      });
    }

    return {
      resolved: true,
      inserted: result.messageId !== undefined,
      aiPaused: result.aiPaused,
      startedByApp: result.startedByApp,
    };
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

    const outcome = await withWorkspace(workspaceId, async (tx) => {
      // Conversas que receberam pelo menos uma mensagem nova (para sinalizar a
      // ChatList uma vez por conversa, fora da transação — sem floodar threads).
      const touchedConversations = new Set<string>();
      // Jobs de download de mídia das mensagens inseridas (publicados após o commit).
      const mediaJobs: InboundMediaJob[] = [];
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
        const contactId = await ensureContact(tx, workspaceId, counterpart, 'whatsapp');
        const { id: conversationId, created: conversationCreated } = await ensureConversation(
          tx,
          workspaceId,
          channelId,
          counterpart,
          contactId,
          HISTORY_CONVERSATION_ORIGIN,
        );
        if (conversationCreated) {
          await applyOriginTag(tx, workspaceId, contactId, HISTORY_CONVERSATION_ORIGIN, null);
        }

        const mediaByExternal = new Map<string, MediaRef>();
        const rows = msgs.map((m) => {
          const mediaRef = extractEchoMediaRef(m.raw, m.type ?? 'text');
          if (mediaRef !== undefined) mediaByExternal.set(m.externalId, mediaRef);
          return {
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
            ...(mediaRef !== undefined ? { mediaStatus: 'pending' as const } : {}),
          };
        });
        messagesTotal += rows.length;

        const inserted = await tx
          .insert(schema.messages)
          .values(rows)
          .onConflictDoNothing({
            target: [schema.messages.conversationId, schema.messages.externalId],
            // Índice parcial uq_messages_external (WHERE external_id IS NOT NULL):
            // o ON CONFLICT precisa repetir o predicado, senão a Graph nega o match.
            where: sql`${schema.messages.externalId} is not null`,
          })
          .returning({ id: schema.messages.id, externalId: schema.messages.externalId });
        messagesInserted += inserted.length;

        // Mídia: enfileira download só p/ as mensagens efetivamente inseridas (dedup
        // não reenfileira). Coletado aqui; publicado após o commit (igual ao echo).
        for (const ins of inserted) {
          if (ins.externalId === null) continue;
          const mediaRef = mediaByExternal.get(ins.externalId);
          if (mediaRef !== undefined) {
            mediaJobs.push({
              provider: COEXISTENCE_PROVIDER,
              externalId: ins.externalId,
              mediaRef,
              routing: { phoneNumberId: payload.phoneNumberId },
            });
          }
        }

        if (inserted.length > 0) {
          touchedConversations.add(conversationId);
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
        resolved: true as const,
        contactsInserted,
        messagesInserted,
        messagesDeduped: messagesTotal - messagesInserted,
        touchedConversations: [...touchedConversations],
        mediaJobs,
      };
    });

    // Pós-persist: um sinal por conversa afetada → a ChatList revalida a projeção
    // (last message/contadores) sem reordenar/floodar a thread com timestamps antigos.
    for (const conversationId of outcome.touchedConversations) {
      await this.socket.emitConversationUpdated(workspaceId, conversationId);
    }

    // Download das mídias históricas (best-effort). Media ids antigos do Meta podem
    // já ter expirado → o media-worker marca 'failed' graciosamente (sem derrubar).
    for (const job of outcome.mediaJobs) {
      await this.media?.enqueue(job);
    }

    return {
      resolved: outcome.resolved,
      contactsInserted: outcome.contactsInserted,
      messagesInserted: outcome.messagesInserted,
      messagesDeduped: outcome.messagesDeduped,
    };
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
 * Garante o contato do `remoteId` (telefone WA ou IGSID do IG — a mesma
 * convenção do inbound: `contacts.phone` guarda o id remoto) dentro do
 * workspace, casando por `uq_contacts_workspace_phone`. Idempotente. Retorna o
 * `contactId`. `source` só vale para o contato recém-criado.
 */
async function ensureContact(
  tx: DbTx,
  workspaceId: string,
  phone: string,
  source: 'whatsapp' | 'instagram',
): Promise<string> {
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
    .values({ workspaceId, phone, source })
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

/** Conversa garantida + se ESTA chamada a criou (base da regra de prospecção). */
interface EnsuredConversation {
  readonly id: string;
  readonly created: boolean;
}

/**
 * Garante a conversa do par (canal, remoteId). Upsert idempotente por
 * `uq_conversations_channel_remote (channel_id, remote_id)`. Nasce com
 * `ai_mode='off'` e com a `origin` dada (F70-S07; conversa existente mantém a
 * dela — origem é decidida uma vez, na criação). `created=true` só para quem de
 * fato inseriu — o perdedor de uma corrida reseleciona e recebe `false`, então
 * a "abertura" é única.
 */
async function ensureConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  remoteId: string,
  contactId: string,
  origin: ConversationOriginValue,
): Promise<EnsuredConversation> {
  const { conversations } = schema;
  const [existing] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (existing !== undefined) return { id: existing.id, created: false };

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
      origin,
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({ id: conversations.id });
  if (created !== undefined) return { id: created.id, created: true };

  const [row] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (row === undefined) {
    throw new Error('coexistence: conversa não materializou após upsert.');
  }
  return { id: row.id, created: false };
}

const uuidSchema = z.string().uuid();

/**
 * Resolve o membro "dono do canal" — a pessoa que responde pelo celular e,
 * portanto, a autora (`sender_member_id`) do eco (F70-S04).
 *
 * O schema não liga canal a membro (não há `created_by`/`owner` em `channels`,
 * e `meta_connections.connected_by` é por workspace+pessoa Meta, sem vínculo ao
 * canal). A ordem, da mais específica para a mais geral:
 *
 * 1. `channels.metadata.ownerMemberId` — apontamento explícito, quando o número
 *    é de alguém que não é o dono do workspace (ex.: um vendedor com o próprio
 *    WhatsApp Business). Só vale se for um membro ATIVO do mesmo workspace;
 *    valor inválido/órfão cai para o passo 2 (nunca atribui a um desconhecido).
 * 2. O OWNER ativo mais antigo do workspace — na operação típica (o Rogério) é
 *    quem tem o número no celular. Ordem estável (`created_at`, `id`) para que
 *    ecos sucessivos tenham sempre o mesmo autor.
 * 3. `null` — a mensagem continua `member` (é humana), só sem autor nomeado.
 */
async function resolveChannelOwner(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
): Promise<string | null> {
  const { channels, members } = schema;

  const [channel] = await tx
    .select({ metadata: channels.metadata })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  const configured = uuidSchema.safeParse(channel?.metadata[CHANNEL_OWNER_METADATA_KEY]);
  if (configured.success) {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, configured.data),
          eq(members.workspaceId, workspaceId),
          eq(members.status, 'active'),
        ),
      )
      .limit(1);
    if (member !== undefined) return member.id;
  }

  const [owner] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        eq(members.role, 'OWNER'),
        eq(members.status, 'active'),
      ),
    )
    .orderBy(asc(members.createdAt), asc(members.id))
    .limit(1);
  return owner?.id ?? null;
}
