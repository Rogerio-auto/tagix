/**
 * Observabilidade da sincronização (F52-S09) — `GET /api/monitoring/sync-health`.
 *
 * Surfaça, num único snapshot, o estado operacional da malha de mensagens:
 *   - profundidade das filas de trabalho + da DLQ + retries em voo (RabbitMQ
 *     management API);
 *   - pendências no banco escopadas ao workspace (mensagens presas em
 *     pending/sending, mídia que falhou);
 *   - status de conexão de cada canal WhatsApp do workspace (ativo, token, quality
 *     rating da Meta).
 *
 * GATING: restrito a OWNER/ADMIN do workspace OU platform-admin (defesa em
 * profundidade — o painel também esconde por role). NÃO expõe dado cross-tenant:
 * as filas são infra (operacional, não-tenant); pendências e canais rodam sob RLS
 * do workspace do solicitante (`req.scoped`).
 *
 * Resiliência: a leitura das filas é injetável (`FetchQueueDepths`) e isolada — se
 * o management API estiver fora, o endpoint degrada (mq.reachable=false) em vez de
 * falhar; as pendências do banco continuam respondendo.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { DLQ_QUEUE, QUEUES, RETRY_BACKOFF_MS, retryWaitQueueName } from '@hm/shared/mq';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { createQueueDepthFetcher, type FetchQueueDepths, type QueueDepth } from './rabbitmq';

const { channels, channelSecrets, messages } = schema;

/** Filas de trabalho principais (exclui DLQ e wait-queues de retry). */
const WORK_QUEUES: readonly string[] = Object.values(QUEUES);

/** Conjunto de wait-queues de retry conhecidas (origem × nível de backoff). */
function retryQueueNames(): Set<string> {
  const names = new Set<string>();
  for (const queue of WORK_QUEUES) {
    for (const ttl of RETRY_BACKOFF_MS) names.add(retryWaitQueueName(queue, ttl));
  }
  return names;
}

type ChannelHealthStatus = 'connected' | 'warning' | 'degraded' | 'inactive' | 'unlinked';

interface ChannelHealth {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly phoneNumber: string | null;
  readonly isActive: boolean;
  readonly hasToken: boolean;
  readonly qualityRating: string | null;
  readonly status: ChannelHealthStatus;
}

interface QueueView {
  readonly name: string;
  readonly messages: number;
  readonly ready: number;
  readonly unacked: number;
  readonly consumers: number;
}

/**
 * Gate de acesso: OWNER/ADMIN do workspace ou platform-admin. Reusa `req.auth`
 * (populado por requireAuth, encadeado antes). 403 caso contrário.
 */
function requireMonitoringAccess(req: Request, res: Response, next: NextFunction): void {
  const member = req.auth?.member;
  if (!member) {
    res.status(401).json({ message: 'Não autenticado.' });
    return;
  }
  const role = member.role;
  if (member.isPlatformAdmin || role === 'OWNER' || role === 'ADMIN') {
    next();
    return;
  }
  res.status(403).json({ message: 'Sem permissão para esta ação.' });
}

/** Deriva o status legível de um canal WhatsApp a partir dos sinais disponíveis. */
function deriveChannelStatus(input: {
  isActive: boolean;
  hasToken: boolean;
  qualityRating: string | null;
}): ChannelHealthStatus {
  if (!input.isActive) return 'inactive';
  if (!input.hasToken) return 'unlinked';
  const q = input.qualityRating?.toUpperCase();
  if (q === 'RED') return 'degraded';
  if (q === 'YELLOW') return 'warning';
  return 'connected';
}

/** Lê o quality rating do metadata do canal (Meta o entrega como GREEN/YELLOW/RED). */
function readQualityRating(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const direct = metadata['qualityRating'] ?? metadata['quality_rating'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return null;
}

export interface MonitoringRouterDeps {
  /** Override da leitura de filas (testes injetam um fake; default = HTTP real). */
  readonly fetchQueueDepths?: FetchQueueDepths;
}

export function createMonitoringRouter(deps: MonitoringRouterDeps = {}): Router {
  const router = Router();
  const fetchQueues = deps.fetchQueueDepths ?? createQueueDepthFetcher();

  router.get(
    '/api/monitoring/sync-health',
    requireAuth,
    requireMonitoringAccess,
    withRLS,
    async (req: Request, res: Response) => {
      // ─── Filas (infra; degrada sem derrubar o restante) ──────────────────────
      let mqReachable = true;
      let mqError: string | undefined;
      let workQueues: QueueView[] = [];
      let dlqDepth = 0;
      let retryInFlight = 0;
      try {
        const depths = await fetchQueues();
        const retryNames = retryQueueNames();
        const byName = new Map<string, QueueDepth>();
        for (const d of depths) byName.set(d.name, d);

        workQueues = WORK_QUEUES.map((name): QueueView => {
          const d = byName.get(name);
          return {
            name,
            messages: d?.messages ?? 0,
            ready: d?.ready ?? 0,
            unacked: d?.unacked ?? 0,
            consumers: d?.consumers ?? 0,
          };
        });
        dlqDepth = byName.get(DLQ_QUEUE)?.messages ?? 0;
        for (const d of depths) {
          if (retryNames.has(d.name)) retryInFlight += d.messages;
        }
      } catch (err: unknown) {
        mqReachable = false;
        mqError = err instanceof Error ? err.message : String(err);
      }

      // ─── Pendências do banco (workspace-scoped via RLS) ───────────────────────
      const MEDIA_TYPES = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];
      const { pendingMessages, mediaFailed, channelRows } = await req.scoped!(async (tx) => {
        const [pending] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(
              eq(messages.direction, 'outbound'),
              inArray(messages.viewStatus, ['pending', 'sending']),
            ),
          );

        const [media] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(
            and(eq(messages.viewStatus, 'failed'), inArray(messages.type, MEDIA_TYPES)),
          );

        const rows = await tx
          .select({
            id: channels.id,
            name: channels.name,
            provider: channels.provider,
            phoneNumber: channels.phoneNumber,
            isActive: channels.isActive,
            metadata: channels.metadata,
            hasToken: sql<boolean>`${channelSecrets.channelId} is not null`,
          })
          .from(channels)
          .leftJoin(channelSecrets, eq(channelSecrets.channelId, channels.id))
          .where(eq(channels.provider, 'meta_whatsapp'));

        return {
          pendingMessages: pending?.n ?? 0,
          mediaFailed: media?.n ?? 0,
          channelRows: rows,
        };
      });

      const channelHealth: ChannelHealth[] = channelRows.map((r) => {
        const qualityRating = readQualityRating(r.metadata);
        const hasToken = r.hasToken === true;
        return {
          id: r.id,
          name: r.name,
          provider: r.provider,
          phoneNumber: r.phoneNumber,
          isActive: r.isActive,
          hasToken,
          qualityRating,
          status: deriveChannelStatus({ isActive: r.isActive, hasToken, qualityRating }),
        };
      });

      res.json({
        generatedAt: new Date().toISOString(),
        mq: { reachable: mqReachable, ...(mqError ? { error: mqError } : {}) },
        queues: workQueues,
        dlq: { name: DLQ_QUEUE, messages: dlqDepth },
        retryInFlight,
        pending: { messages: pendingMessages, mediaFailed },
        channels: channelHealth,
      });
    },
  );

  return router;
}
