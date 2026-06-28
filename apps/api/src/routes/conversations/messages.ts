/**
 * Envio de mensagem outbound (F1-S24 / LIVECHAT.md §3).
 *
 * `POST /api/conversations/:id/messages`: valida o body (Zod), persiste a
 * mensagem em estado `pending` (direction `outbound`) sob RLS, e enfileira um
 * `OutboundJob` em `hm.q.outbound`. O worker outbound consome a fila, dispara ao
 * provider e finaliza o `view_status` (sent/delivered/failed). A UI já faz
 * optimistic update; aqui a bolha vira real (`{ message }`).
 *
 * O shape do job publicado é o contrato exato de `parseOutboundJob`
 * (`apps/workers/src/outbound/job.ts`): `kind` discrimina text/media, com
 * `channelId`/`conversationId`/`messageId`/`chatId` da conversa resolvida.
 *
 * `messageTag` (janela 24h Instagram) é repassado ao job e — quando presente —
 * registrado em `audit_logs` (envio fora da janela é ação auditável).
 *
 * F30-S04 — auto-pausa de IA no handoff humano:
 *  - Quando o sender é membro humano (não agente), se `ai_mode='on'`, seta
 *    `ai_mode='paused'`, `ai_paused_reason='human_takeover'`, `ai_paused_at=now()`,
 *    `ai_paused_by=<member>`, `ai_last_human_at=now()` na mesma transação.
 *  - Se já `paused` ou `off`, apenas atualiza `ai_last_human_at` (idempotente).
 *  - Emite `conversation:ai_mode_changed` via relay best-effort quando a IA pausa.
 *
 * Router NÃO montado aqui — o orchestrator monta `createMessagesRouter()` em
 * `apps/api/src/app.ts`.
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import {
  contactsPayloadSchema,
  locationPayloadSchema,
  reactionPayloadSchema,
} from '@hm/shared';
import type {
  AiMode,
  ContactsPayload,
  ConversationAiModeChangedPayload,
  LocationPayload,
  ReactionPayload,
  Role,
} from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { publishOutboundJob } from '../../mq/outbound-publisher';

/** Limite de corpo de texto (anti-abuso; alinhado a `MAX_NOTE_BODY`). */
const MAX_TEXT_LEN = 5000;

/**
 * Tags IG fora da janela 24h — espelham `igMessageTagSchema` do worker. Mantidas
 * locais para não importar do grafo de `apps/workers` (fora do build da API).
 */
const IG_MESSAGE_TAGS = [
  'HUMAN_AGENT',
  'CONFIRMED_EVENT_UPDATE',
  'POST_PURCHASE_UPDATE',
  'ACCOUNT_UPDATE',
] as const;

/** Kinds de mídia enviáveis — espelham `outboundMediaKindSchema` do worker. */
type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

/** Normaliza o `type` do client (que pode mandar `'file'`) p/ um kind de mídia. */
const TYPE_TO_MEDIA_KIND: Readonly<Record<string, MediaKind>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  file: 'document',
  sticker: 'sticker',
};

/**
 * Body do envio. Contrato com o frontend (`features/conversations/queries.ts`):
 * `{ content, type, mediaUrl }`. `mediaMime`/`messageTag` são extensões opcionais
 * (mídia precisa de mime válido p/ o provider; messageTag p/ janela IG 24h).
 *
 * F45 — modalidades ricas: `type` pode ser `location`/`contact`/`reaction`, caso
 * em que o corpo carrega um `payload` validado pelos schemas de `@hm/shared`
 * (`messaging-payloads`). `payload` chega como `unknown` e é narrowed por kind.
 */
const sendSchema = z
  .object({
    content: z.string().trim().min(1).max(MAX_TEXT_LEN).nullable().optional(),
    type: z.string().trim().min(1).default('text'),
    mediaUrl: z.string().url().nullable().optional(),
    mediaMime: z.string().trim().min(1).nullable().optional(),
    messageTag: z.enum(IG_MESSAGE_TAGS).optional(),
    payload: z.unknown().optional(),
  })
  .strip();

type SendBody = z.infer<typeof sendSchema>;

/** Modalidades ricas (F45) que carregam `payload` validado em vez de `content`/mídia. */
type RichKind = 'location' | 'contacts' | 'reaction';

/**
 * Payload rico já validado, pronto para persistir + montar o job. `reaction`
 * carrega o `targetExternalId` resolvido sob RLS (não o `targetMessageId` cru).
 */
type RichPayload =
  | { readonly kind: 'location'; readonly location: LocationPayload }
  | { readonly kind: 'contacts'; readonly contacts: ContactsPayload }
  | {
      readonly kind: 'reaction';
      readonly reaction: ReactionPayload;
      readonly targetExternalId: string;
    };

/** Resolve `type` do client → modalidade rica, ou `null` (texto/mídia). */
function richKindFor(type: string): RichKind | null {
  if (type === 'location') return 'location';
  if (type === 'contact' || type === 'contacts') return 'contacts';
  if (type === 'reaction') return 'reaction';
  return null;
}

/** `type` persistido em `messages.type` (check constraint usa `contact` singular). */
function storedType(type: string, richKind: RichKind | null): string {
  if (richKind === 'contacts') return 'contact';
  return type;
}

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

/** Limite do header `Idempotency-Key` (anti-abuso). */
const MAX_IDEMPOTENCY_KEY_LEN = 200;

/**
 * F52-S04 — chave de idempotência de envio na borda. Opt-in via header
 * `Idempotency-Key`: o cliente que reenvia o MESMO POST (retry/duplo-clique)
 * recebe a mensagem já criada em vez de duplicá-la. Persistida em
 * `messages.outbound_idempotency_key` (índice único parcial garante a unicidade
 * no DB). Ausente/ inválida → `null` (comportamento legado, sem dedup).
 */
function parseIdempotencyKey(raw: string | string[] | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LEN) return null;
  return value;
}

/** Resolve `type` → kind de mídia, ou `null` quando é texto puro. */
function mediaKindFor(type: string): MediaKind | null {
  return TYPE_TO_MEDIA_KIND[type] ?? null;
}

interface ResolvedConversation {
  readonly channelId: string;
  readonly remoteId: string;
  readonly aiMode: string;
}

/** Linha completa de `messages` (resultado de insert `.returning()` / select). */
type MessageRow = typeof schema.messages.$inferSelect;

/**
 * Resultado da transação de envio (F52-S04). `null` = conversa inexistente/
 * invisível (404); `replay` = idempotência (mensagem já criada, 200 sem
 * enqueue); `created` = inserida agora (201 + enqueue).
 */
type SendScopedResult =
  | { readonly kind: 'replay'; readonly message: MessageRow }
  | {
      readonly kind: 'created';
      readonly conversation: ResolvedConversation;
      readonly message: MessageRow;
      readonly aiPausedByHandoff: boolean;
      /** Payload rico resolvido (com `targetExternalId` da reação) ou `null`. */
      readonly rich: RichPayload | null;
    }
  | null;

/**
 * Classificação rica pré-transação: location/contacts já têm o payload validado;
 * reaction tem o payload validado mas o `targetExternalId` só é resolvido sob RLS
 * dentro da transação. `null` = não é modalidade rica (texto/mídia).
 */
type PreRich =
  | { readonly kind: 'location'; readonly location: LocationPayload }
  | { readonly kind: 'contacts'; readonly contacts: ContactsPayload }
  | { readonly kind: 'reaction'; readonly reaction: ReactionPayload }
  | null;

/**
 * Monta o `OutboundJob` no shape EXATO de `parseOutboundJob`. `chatId` é o id do
 * contato no provider (`conversations.remote_id`); `channelId` resolve a
 * credencial; `messageId` correlaciona o status final.
 */
function buildOutboundJob(args: {
  readonly conv: ResolvedConversation;
  readonly conversationId: string;
  readonly messageId: string;
  readonly body: SendBody;
  readonly mediaKind: MediaKind | null;
  readonly rich: RichPayload | null;
}): Record<string, unknown> {
  const { conv, conversationId, messageId, body, mediaKind, rich } = args;
  const base = {
    channelId: conv.channelId,
    conversationId,
    messageId,
    chatId: conv.remoteId,
  };

  if (rich) {
    switch (rich.kind) {
      case 'location':
        return {
          kind: 'location',
          ...base,
          latitude: rich.location.latitude,
          longitude: rich.location.longitude,
          ...(rich.location.name !== undefined ? { name: rich.location.name } : {}),
          ...(rich.location.address !== undefined ? { address: rich.location.address } : {}),
          ...(body.messageTag ? { messageTag: body.messageTag } : {}),
        };
      case 'contacts':
        return {
          kind: 'contacts',
          ...base,
          contacts: rich.contacts.contacts,
          ...(body.messageTag ? { messageTag: body.messageTag } : {}),
        };
      case 'reaction':
        return {
          kind: 'reaction',
          ...base,
          targetExternalId: rich.targetExternalId,
          emoji: rich.reaction.emoji,
        };
    }
  }

  if (mediaKind) {
    return {
      kind: 'media',
      ...base,
      mediaKind,
      // `mediaUrl`/`mediaMime` já validados como presentes antes desta chamada.
      publicMediaUrl: body.mediaUrl,
      mime: body.mediaMime,
      ...(body.content ? { caption: body.content } : {}),
      ...(body.messageTag ? { messageTag: body.messageTag } : {}),
    };
  }

  return {
    kind: 'text',
    ...base,
    text: body.content,
    ...(body.messageTag ? { messageTag: body.messageTag } : {}),
  };
}

// ── Relay AMQP (best-effort, mesma estratégia de state.ts) ────────────────────

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Handle AMQP lazy singleton por processo. */
let mqHandlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  mqHandlePromise ??= connectMq();
  try {
    return await mqHandlePromise;
  } catch (err) {
    mqHandlePromise = null;
    throw err;
  }
}

/**
 * Publica `conversation:ai_mode_changed` na fila de relay do socket.
 * Best-effort: se o broker não estiver disponível o erro é silenciado —
 * a persistência já está commitada quando chegamos aqui.
 */
async function emitAiModeChanged(
  workspaceId: string,
  conversationId: string,
  aiMode: AiMode,
): Promise<void> {
  const { channel } = await getMqHandle();
  const payload: ConversationAiModeChangedPayload = {
    conversationId,
    aiMode,
    reason: 'human_takeover',
  };
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event: 'conversation:ai_mode_changed' as const,
    target: { conversationId, workspace: true },
    data: payload,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

export function createMessagesRouter(): Router {
  const router = Router();
  // Enviar mensagem é ação de staff (READONLY não envia). Sem permissão dedicada
  // no matriz atual → reusa `conversation.assign` (STAFF), mesmo critério de `notes.ts`.
  const sendGuard = [requireAuth, withRLS, requireRole('conversation.assign')] as const;

  // POST /api/conversations/:id/messages — persiste pending + enfileira outbound.
  router.post(
    '/api/conversations/:id/messages',
    ...sendGuard,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }

      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Mensagem inválida.' });
        return;
      }
      const body = parsed.data;
      const mediaKind = mediaKindFor(body.type);
      const richKind = mediaKind ? null : richKindFor(body.type);

      // Validação do `payload` das modalidades ricas (Zod, toda input externa).
      // `targetExternalId` da reação é resolvido depois, sob RLS, na transação.
      let preRich: PreRich = null;
      if (richKind === 'location') {
        const r = locationPayloadSchema.safeParse(body.payload);
        if (!r.success) {
          res.status(400).json({ message: 'Localização inválida (latitude/longitude).' });
          return;
        }
        preRich = { kind: 'location', location: r.data };
      } else if (richKind === 'contacts') {
        const r = contactsPayloadSchema.safeParse(body.payload);
        if (!r.success) {
          res.status(400).json({ message: 'Contato inválido.' });
          return;
        }
        preRich = { kind: 'contacts', contacts: r.data };
      } else if (richKind === 'reaction') {
        const r = reactionPayloadSchema.safeParse(body.payload);
        if (!r.success) {
          res.status(400).json({ message: 'Reação inválida (targetMessageId/emoji).' });
          return;
        }
        preRich = { kind: 'reaction', reaction: r.data };
      }

      // Coerência por kind: mídia exige url+mime; rico exige payload (já validado);
      // texto exige content.
      if (mediaKind) {
        if (!body.mediaUrl || !body.mediaMime) {
          res.status(400).json({ message: 'Mídia exige mediaUrl e mediaMime.' });
          return;
        }
      } else if (richKind) {
        // payload já validado acima; nada mais a exigir aqui.
      } else if (!body.content) {
        res.status(400).json({ message: 'Texto exige content.' });
        return;
      }

      const workspaceId = req.auth!.workspace.id;
      const senderMemberId = req.auth!.member.id;
      const senderRole = req.auth!.member.role as Role;
      const idempotencyKey = parseIdempotencyKey(req.headers['idempotency-key']);

      // Persiste a mensagem `pending` sob RLS, validando que a conversa existe no
      // tenant (RLS escopa a query — conversa de outro workspace some).
      // F30-S04: na mesma transação aplica a lógica de auto-pausa de IA.
      const result = await req.scoped!(async (tx): Promise<SendScopedResult> => {
        // Guard de visibilidade por-conversa (S07.1): fecha o IDOR de escrita — não
        // basta a conversa existir no tenant, precisa ser visível ao remetente
        // (senão um membro enviaria ao contato de outro time/depto). 404 = não confirma.
        if (
          !(await assertConversationVisible(
            tx,
            { memberId: senderMemberId, role: senderRole, workspaceId },
            conversationId,
          ))
        ) {
          return null;
        }
        const [conversation] = await tx
          .select({
            channelId: schema.conversations.channelId,
            remoteId: schema.conversations.remoteId,
            aiMode: schema.conversations.aiMode,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;

        // F52-S04 — idempotência de envio: se o cliente reenviou o MESMO POST
        // (mesma Idempotency-Key), devolve a mensagem já criada sem duplicar o
        // INSERT nem o enqueue. Escopo conversa+workspace (defesa em profundidade
        // sobre o índice único global da chave).
        if (idempotencyKey !== null) {
          const [existing] = await tx
            .select()
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.workspaceId, workspaceId),
                eq(schema.messages.conversationId, conversationId),
                eq(schema.messages.outboundIdempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) return { kind: 'replay', message: existing };
        }

        // Resolve a modalidade rica. Para `reaction`, resolve o `external_id` da
        // mensagem-alvo SOB RLS, exigindo que ela seja da MESMA conversa visível —
        // o cliente nunca informa o `external_id` direto (evita vazamento
        // cross-tenant). Sem alvo válido (invisível / sem external_id) → 404.
        let rich: RichPayload | null = null;
        if (preRich?.kind === 'reaction') {
          const [target] = await tx
            .select({ externalId: schema.messages.externalId })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.workspaceId, workspaceId),
                eq(schema.messages.conversationId, conversationId),
                eq(schema.messages.id, preRich.reaction.targetMessageId),
              ),
            )
            .limit(1);
          if (!target || !target.externalId) return null;
          rich = {
            kind: 'reaction',
            reaction: preRich.reaction,
            targetExternalId: target.externalId,
          };
        } else if (preRich?.kind === 'location') {
          rich = { kind: 'location', location: preRich.location };
        } else if (preRich?.kind === 'contacts') {
          rich = { kind: 'contacts', contacts: preRich.contacts };
        }

        // `content` legível por kind (preview na timeline). Mídia mantém o comportamento
        // legado (caption); ricos guardam o dado estruturado em colunas dedicadas.
        const richContent =
          rich?.kind === 'location'
            ? (rich.location.name ?? null)
            : rich?.kind === 'reaction'
              ? rich.reaction.emoji || null
              : rich?.kind === 'contacts'
                ? (rich.contacts.contacts[0]?.name ?? null)
                : null;

        const [message] = await tx
          .insert(schema.messages)
          .values({
            workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'member',
            senderMemberId,
            type: storedType(body.type, richKind),
            content: richKind ? richContent : (body.content ?? null),
            viewStatus: 'pending',
            externalId: null,
            outboundIdempotencyKey: idempotencyKey,
            mediaUrl: body.mediaUrl ?? null,
            mediaMime: body.mediaMime ?? null,
            mediaCaption: mediaKind && body.content ? body.content : null,
            ...(rich?.kind === 'reaction'
              ? {
                  reactionEmoji: rich.reaction.emoji,
                  replyToMessageId: rich.reaction.targetMessageId,
                }
              : {}),
            ...(rich?.kind === 'location' ? { metadata: { location: rich.location } } : {}),
            ...(rich?.kind === 'contacts'
              ? { metadata: { contacts: rich.contacts.contacts } }
              : {}),
          })
          .returning();
        if (!message) return null;

        // Envio com tag IG (fora da janela 24h) é ação auditável.
        if (body.messageTag != null) {
          await tx.insert(schema.auditLogs).values({
            workspaceId,
            actorMemberId: senderMemberId,
            actorType: 'member',
            action: 'message.send_with_tag',
            resourceType: 'message',
            resourceId: message.id,
            metadata: { messageTag: body.messageTag, conversationId },
          });
        }

        // F30-S04 — auto-pausa de IA ao humano responder.
        // Narrows: aiMode vem do DB como `text` (string); o check constraint garante
        // o domínio ('off'|'on'|'paused'), mas o TS ainda vê `string` — comparamos
        // diretamente com a literal para manter strict sem cast.
        const now = new Date();
        let aiPausedByHandoff = false;

        if (conversation.aiMode === 'on') {
          // Transição on → paused (human_takeover). Seta todos os campos de pausa.
          await tx
            .update(schema.conversations)
            .set({
              aiMode: 'paused',
              aiPausedReason: 'human_takeover',
              aiPausedAt: now,
              aiPausedBy: senderMemberId,
              aiLastHumanAt: now,
              updatedAt: now,
            })
            .where(eq(schema.conversations.id, conversationId));
          aiPausedByHandoff = true;
        } else {
          // Já paused ou off: apenas registra a atividade humana (base de S06).
          // Não regride: paused não vira on; off não muda.
          await tx
            .update(schema.conversations)
            .set({
              aiLastHumanAt: now,
              updatedAt: now,
            })
            .where(eq(schema.conversations.id, conversationId));
        }

        return { kind: 'created', conversation, message, aiPausedByHandoff, rich };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }

      // Replay idempotente: mensagem já existia → devolve sem reenfileirar.
      if (result.kind === 'replay') {
        res.status(200).json({ message: result.message });
        return;
      }

      const { conversation, message, aiPausedByHandoff, rich } = result;

      // Enfileira o envio real. Shape EXATO de `parseOutboundJob` (worker valida).
      // Best-effort em falha de broker: a mensagem já está `pending` e a UI já
      // reconciliou; um erro de infra aqui propaga p/ o error handler (5xx) sem
      // duplicar a persistência.
      const job = buildOutboundJob({
        conv: conversation,
        conversationId,
        messageId: message.id,
        body,
        mediaKind,
        rich,
      });
      await publishOutboundJob(workspaceId, job);

      // F30-S04: emite evento de handoff se a IA acabou de pausar (best-effort).
      if (aiPausedByHandoff) {
        await Promise.allSettled([
          emitAiModeChanged(workspaceId, conversationId, 'paused'),
        ]);
      }

      res.status(201).json({ message });
    },
  );

  return router;
}
