/**
 * Fan-out de eventos de domínio → entregas de webhook (F9-S05).
 *
 * Dado um evento de domínio de um workspace, cria uma `outbound_webhook_deliveries`
 * (estado `pending`, `next_attempt_at = now()`) para cada `outbound_webhooks` ATIVO
 * desse workspace que assina o evento. O dispatcher (`./dispatcher`) drena e despacha.
 * Quem chama em produção é o consumer de `hm.q.webhooks` (`./consumer`, F70-S09).
 *
 * Idempotência: cada chamada carrega um `eventId` estável (id da entidade de origem
 * + sufixo do tipo de evento). Guardamos `event_id` em `payload._meta.eventId` e
 * deduplicamos por (webhook_id, event_id) — um mesmo evento de domínio reentregue
 * (replay de fila, retry do produtor) não duplica deliveries.
 *
 * Dedup indexado (F70-S16): índice único `uq_outbound_webhook_deliveries_event` em
 * `(webhook_id, payload #>> '{_meta,eventId}')` + `INSERT … ON CONFLICT DO NOTHING`.
 * Um comando para todos os assinantes, sem varrer as entregas do webhook e sem
 * advisory lock: dois consumidores do MESMO evento (reentrega da fila, republicação
 * do relay da outbox) disputam no índice e só um grava.
 *
 * Roda como owner (`getDb()`): fan-out é operação de plataforma sobre um tenant
 * conhecido (workspaceId vem do evento); o isolamento já está embutido no filtro.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';

const { outboundWebhooks } = schema;

export interface WebhookEvent {
  readonly workspaceId: string;
  /** Nome do evento assinável (catálogo `DOMAIN_EVENTS` de `@hm/shared/mq`). */
  readonly event: string;
  /** Id estável da ocorrência (dedup por webhook). Ex.: `${messageId}:sent`. */
  readonly eventId: string;
  /** Corpo livre entregue ao cliente (será envelopado com _meta no dispatch). */
  readonly data: Record<string, unknown>;
  /** Instante da ocorrência (ISO-8601), repassado ao cliente em `_meta.occurredAt`. */
  readonly occurredAt?: string;
}

export interface FanoutResult {
  readonly matchedWebhooks: number;
  readonly created: number;
  readonly deduped: number;
}

/**
 * Cria deliveries pendentes para todos os webhooks ativos que assinam `event`.
 * Retorna a contagem para telemetria/teste. Não despacha — só enfileira (durável).
 */
export async function fanoutEvent(evt: WebhookEvent): Promise<FanoutResult> {
  const db = getDb();

  // Webhooks ATIVOS do workspace que assinam este evento (event ∈ events[]).
  const subscribers = await db
    .select({ id: outboundWebhooks.id })
    .from(outboundWebhooks)
    .where(
      and(
        eq(outboundWebhooks.workspaceId, evt.workspaceId),
        eq(outboundWebhooks.isActive, true),
        sql`${evt.event} = ANY(${outboundWebhooks.events})`,
      ),
    );

  if (subscribers.length === 0) {
    return { matchedWebhooks: 0, created: 0, deduped: 0 };
  }

  const meta = {
    eventId: evt.eventId,
    event: evt.event,
    ...(evt.occurredAt !== undefined ? { occurredAt: evt.occurredAt } : {}),
  };
  const payload = JSON.stringify({ ...evt.data, _meta: meta });
  // Literal de array uuid (ids vêm do banco, validados como uuid pelo Postgres no cast).
  const webhookIds = `{${subscribers.map((s) => s.id).join(',')}}`;

  const inserted = await db.execute(sql`
    INSERT INTO outbound_webhook_deliveries
      (webhook_id, workspace_id, event, payload, status, next_attempt_at)
    SELECT w.id, ${evt.workspaceId}::uuid, ${evt.event}, ${payload}::jsonb, 'pending', now()
      FROM unnest(${webhookIds}::uuid[]) AS w(id)
    ON CONFLICT (webhook_id, (payload #>> '{_meta,eventId}')) DO NOTHING
    RETURNING id
  `);
  const created = Array.from(inserted).length;
  const deduped = subscribers.length - created;

  return { matchedWebhooks: subscribers.length, created, deduped };
}
