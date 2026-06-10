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
 * Router NÃO montado aqui — o orchestrator monta `createMessagesRouter()` em
 * `apps/api/src/app.ts`.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
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
 */
const sendSchema = z
  .object({
    content: z.string().trim().min(1).max(MAX_TEXT_LEN).nullable().optional(),
    type: z.string().trim().min(1).default('text'),
    mediaUrl: z.string().url().nullable().optional(),
    mediaMime: z.string().trim().min(1).nullable().optional(),
    messageTag: z.enum(IG_MESSAGE_TAGS).optional(),
  })
  .strip();

type SendBody = z.infer<typeof sendSchema>;

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

/** Resolve `type` → kind de mídia, ou `null` quando é texto puro. */
function mediaKindFor(type: string): MediaKind | null {
  return TYPE_TO_MEDIA_KIND[type] ?? null;
}

interface ResolvedConversation {
  readonly channelId: string;
  readonly remoteId: string;
}

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
}): Record<string, unknown> {
  const { conv, conversationId, messageId, body, mediaKind } = args;
  const base = {
    channelId: conv.channelId,
    conversationId,
    messageId,
    chatId: conv.remoteId,
  };

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

      // Coerência do payload por kind: mídia exige url+mime; texto exige content.
      if (mediaKind) {
        if (!body.mediaUrl || !body.mediaMime) {
          res.status(400).json({ message: 'Mídia exige mediaUrl e mediaMime.' });
          return;
        }
      } else if (!body.content) {
        res.status(400).json({ message: 'Texto exige content.' });
        return;
      }

      const workspaceId = req.auth!.workspace.id;
      const senderMemberId = req.auth!.member.id;

      // Persiste a mensagem `pending` sob RLS, validando que a conversa existe no
      // tenant (RLS escopa a query — conversa de outro workspace some).
      const result = await req.scoped!(async (tx) => {
        const [conversation] = await tx
          .select({
            channelId: schema.conversations.channelId,
            remoteId: schema.conversations.remoteId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return null;

        const [message] = await tx
          .insert(schema.messages)
          .values({
            workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'member',
            senderMemberId,
            type: body.type,
            content: body.content ?? null,
            viewStatus: 'pending',
            externalId: null,
            mediaUrl: body.mediaUrl ?? null,
            mediaMime: body.mediaMime ?? null,
            mediaCaption: mediaKind && body.content ? body.content : null,
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

        return { conversation, message };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }

      const { conversation, message } = result;

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
      });
      await publishOutboundJob(workspaceId, job);

      res.status(201).json({ message });
    },
  );

  return router;
}
