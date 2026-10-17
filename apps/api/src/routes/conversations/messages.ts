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
 *  - F70-S07: a regra é `planHumanReply` (`@hm/shared`), a MESMA que o worker aplica
 *    ao eco do app (WhatsApp coexistência / Instagram). Uma regra, duas pontas.
 *
 * F70-S27 — `POST /api/conversations/:id/messages/:messageId/retry-media`: o
 * "Tentar de novo" da mídia recebida que falhou. Reenfileira o download pela outbox,
 * na mesma transação que volta o status para `pending` (ver `decideMediaRetry`).
 *
 * Router NÃO montado aqui — o orchestrator monta `createMessagesRouter()` em
 * `apps/api/src/app.ts`.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { assertConversationVisible, enqueueOutbox, schema } from '@hm/db';
import { makeEnvelope, QUEUES, queueJobOutbox } from '@hm/shared/mq';
import {
  CHANNEL_PROVIDERS,
  contactsPayloadSchema,
  locationPayloadSchema,
  reactionPayloadSchema,
} from '@hm/shared';
import type { ContactsPayload, LocationPayload, ReactionPayload, Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  IG_MESSAGE_TAGS,
  buildOutboundJob,
  type MediaKind,
  type RichPayload,
} from '../../services/messaging/outbound-job';
import { emitAiModeChanged, persistMemberOutbound } from '../../services/messaging/send-on-behalf';

/** Limite de corpo de texto (anti-abuso; alinhado a `MAX_NOTE_BODY`). */
const MAX_TEXT_LEN = 5000;

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
    // Key estável do objeto no storage (R2). Gravada em `metadata.mediaKey` para
    // reidratar a signed URL via `refresh-media-url` quando o `mediaUrl` (7d) expirar.
    mediaKey: z.string().trim().min(1).nullable().optional(),
    messageTag: z.enum(IG_MESSAGE_TAGS).optional(),
    payload: z.unknown().optional(),
  })
  .strip();

/** Modalidades ricas (F45) que carregam `payload` validado em vez de `content`/mídia. */
type RichKind = 'location' | 'contacts' | 'reaction';

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

// ─── "Tentar de novo" da mídia recebida (F70-S27) ─────────────────────────────
//
// Espelha contratos do worker de mídia sem importar o grafo de `apps/workers` (fora do
// build da API), como `IG_MESSAGE_TAGS` acima:
//  - o job é o de `media/job.ts` (`mediaJobSchema`), gravado pelo worker em
//    `metadata.mediaJob` quando a mídia falha;
//  - os motivos terminais são os de `TERMINAL_MEDIA_FAILURES` (`media/ports.ts`);
//  - a regra de "pedido em voo" é a de `reprocessInFlight` (`media/reprocess.ts`).

/** Tipo do envelope do job de mídia (= `INBOUND_MEDIA_TYPE` do worker). */
const INBOUND_MEDIA_TYPE = 'inbound.media.requested';
const MEDIA_FAILURE_META = 'mediaFailure';
const MEDIA_JOB_META = 'mediaJob';
const MEDIA_REPROCESS_META = 'mediaReprocess';
const TERMINAL_MEDIA_FAILURES: ReadonlySet<string> = new Set([
  'media_expired',
  'media_unavailable',
  'empty_media',
]);
/** Pendente há mais que isto sem virar mídia = travada (a UI desiste no mesmo prazo). */
const MEDIA_STUCK_MS = 2 * 60_000;
/** Um pedido de "tentar de novo" em voo segura novos pedidos por este tempo. */
const MEDIA_RETRY_COOLDOWN_MS = 10 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storedMediaJobSchema = z.object({
  provider: z.enum(CHANNEL_PROVIDERS),
  externalId: z.string().min(1),
  mediaRef: z.object({
    refOrUrl: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    sha256: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
  }),
  routing: z.object({
    phoneNumberId: z.string().min(1).optional(),
    igUserId: z.string().min(1).optional(),
    wahaSession: z.string().min(1).optional(),
  }),
});
type StoredMediaJob = z.infer<typeof storedMediaJobSchema>;

const failureMetaSchema = z.object({ reason: z.string(), at: z.string().optional() }).passthrough();
const reprocessMetaSchema = z.object({ requestedAt: z.string() }).passthrough();

type RetryMediaRefusal =
  | 'already_ready'
  | 'not_retryable'
  | 'terminal'
  | 'in_progress'
  | 'no_reference';
type RetryMediaOutcome = 'not_found' | 'queued' | 'already_queued' | RetryMediaRefusal;

const RETRY_MEDIA_MESSAGES: Readonly<Record<RetryMediaRefusal, string>> = {
  already_ready: 'A mídia já está disponível.',
  not_retryable: 'Esta mensagem não tem mídia recebida para recuperar.',
  terminal: 'O arquivo não existe mais na origem e não pode ser recuperado.',
  in_progress: 'A mídia ainda está sendo carregada.',
  no_reference: 'Não foi possível tentar de novo por aqui. O suporte consegue recuperar esta mídia.',
};

function parseIso(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide o "tentar de novo" a partir da linha travada. PURA e exportada para teste.
 *
 * Só retenta mídia recebida, não ingerida, com falha recuperável (ou pendente além
 * do prazo) e com o job guardado. Um pedido feito DEPOIS da última falha e há menos
 * de {@link MEDIA_RETRY_COOLDOWN_MS} está em voo: responde sem duplicar.
 */
export function decideMediaRetry(row: {
  readonly direction: string;
  readonly mediaStatus: string | null;
  readonly mediaSha256: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly now: Date;
}):
  | { readonly kind: 'retry'; readonly job: StoredMediaJob }
  | { readonly kind: RetryMediaRefusal | 'already_queued' } {
  if (row.mediaSha256 !== null || row.mediaStatus === 'ready') return { kind: 'already_ready' };
  if (row.direction !== 'inbound' || row.mediaStatus === null) return { kind: 'not_retryable' };

  const failure = failureMetaSchema.safeParse(row.metadata[MEDIA_FAILURE_META]);
  if (failure.success && TERMINAL_MEDIA_FAILURES.has(failure.data.reason)) {
    return { kind: 'terminal' };
  }
  const stuck =
    row.mediaStatus === 'failed' || row.now.getTime() - row.createdAt.getTime() > MEDIA_STUCK_MS;
  if (!stuck) return { kind: 'in_progress' };

  const reprocess = reprocessMetaSchema.safeParse(row.metadata[MEDIA_REPROCESS_META]);
  const requestedAt = reprocess.success ? parseIso(reprocess.data.requestedAt) : null;
  const failedAt = failure.success ? parseIso(failure.data.at) : null;
  if (
    requestedAt !== null &&
    (failedAt === null || failedAt < requestedAt) &&
    row.now.getTime() - requestedAt < MEDIA_RETRY_COOLDOWN_MS
  ) {
    return { kind: 'already_queued' };
  }

  const job = storedMediaJobSchema.safeParse(row.metadata[MEDIA_JOB_META]);
  if (!job.success) return { kind: 'no_reference' };
  return { kind: 'retry', job: job.data };
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
      readonly message: MessageRow;
      readonly aiPausedByHandoff: boolean;
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

        // Núcleo do envio do membro (F73-S09: `services/messaging/send-on-behalf`, o mesmo
        // caminho do envio em nome do membro): mensagem `pending`, trilha da tag IG,
        // auto-pausa de IA (F30-S04/F70-S07) e o job de envio na outbox NESTA transação
        // (F70-S21) — commit da mensagem e do job é o mesmo.
        const persisted = await persistMemberOutbound(tx, {
          workspaceId,
          conversationId,
          conversation,
          senderMemberId,
          messageTag: body.messageTag ?? null,
          values: {
            type: storedType(body.type, richKind),
            content: richKind ? richContent : (body.content ?? null),
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
            // Mídia já vive no storage (R2) sob `mediaKey`. Grava a key estável em
            // `metadata.mediaKey` (mesma chave que `refresh-media-url` reidrata) e marca
            // `ready` — sem isto a signed URL de 7d expira e a UI cai em 404 no retry.
            // Ricos (location/contacts) e mídia são mutuamente exclusivos → sem colisão.
            ...(mediaKind && body.mediaKey
              ? { metadata: { mediaKey: body.mediaKey }, mediaStatus: 'ready' as const }
              : {}),
          },
          // Shape EXATO de `parseOutboundJob` (o worker valida).
          job: (messageId) =>
            buildOutboundJob({
              conv: conversation,
              conversationId,
              messageId,
              body,
              mediaKind,
              rich,
            }),
        });
        if (!persisted) return null;

        return {
          kind: 'created',
          message: persisted.message,
          aiPausedByHandoff: persisted.aiPausedByHandoff,
        };
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

      const { message, aiPausedByHandoff } = result;

      // F30-S04: emite evento de handoff se a IA acabou de pausar (best-effort).
      if (aiPausedByHandoff) {
        await Promise.allSettled([
          emitAiModeChanged(workspaceId, conversationId, 'paused'),
        ]);
      }

      res.status(201).json({ message });
    },
  );

  // POST /api/conversations/:id/messages/:messageId/retry-media — "Tentar de novo" da
  // mídia recebida que falhou (F70-S27). Reenfileira o download pela outbox.
  router.post(
    '/api/conversations/:id/messages/:messageId/retry-media',
    ...sendGuard,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      const messageId = paramId(req, 'messageId');
      if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId)) {
        res.status(400).json({ message: 'id ou messageId inválido.' });
        return;
      }
      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;

      const outcome = await req.scoped!(
        async (tx): Promise<RetryMediaOutcome> => {
          if (
            !(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))
          ) {
            return 'not_found';
          }
          const { messages } = schema;
          // FOR UPDATE: dois cliques (ou duas abas) serializam aqui; o segundo vê o
          // pedido do primeiro e não duplica o job.
          const [row] = await tx
            .select({
              direction: messages.direction,
              mediaStatus: messages.mediaStatus,
              mediaSha256: messages.mediaSha256,
              metadata: messages.metadata,
              createdAt: messages.createdAt,
            })
            .from(messages)
            .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
            .limit(1)
            .for('update');
          if (row === undefined) return 'not_found';

          const now = new Date();
          const decision = decideMediaRetry({ ...row, now });
          if (decision.kind !== 'retry') return decision.kind;

          const mark = {
            [MEDIA_REPROCESS_META]: { requestedAt: now.toISOString(), source: 'member', memberId },
          };
          await tx
            .update(messages)
            .set({
              mediaStatus: 'pending',
              metadata: sql`${messages.metadata} || ${JSON.stringify(mark)}::jsonb`,
              updatedAt: now,
            })
            .where(eq(messages.id, messageId));
          await enqueueOutbox(
            tx,
            queueJobOutbox(
              QUEUES.media,
              makeEnvelope(INBOUND_MEDIA_TYPE, workspaceId, decision.job),
            ),
          );
          return 'queued';
        },
      );

      switch (outcome) {
        case 'not_found':
          res.status(404).json({ message: 'Mensagem não encontrada.' });
          return;
        case 'queued':
        case 'already_queued':
          res.status(202).json({ status: outcome });
          return;
        default:
          res.status(409).json({ code: outcome, message: RETRY_MEDIA_MESSAGES[outcome] });
      }
    },
  );

  return router;
}
