/**
 * Fan-out de eventos de domínio → entregas de webhook (F9-S05).
 *
 * Dado um evento de domínio de um workspace, cria uma `outbound_webhook_deliveries`
 * (estado `pending`, `next_attempt_at = now()`) para cada `outbound_webhooks` ATIVO
 * desse workspace que assina o evento. O dispatcher (`./dispatcher`) drena e despacha.
 *
 * Idempotência: cada chamada carrega um `eventId` estável (id da entidade de origem
 * + sufixo do tipo de evento). Guardamos `event_id` em `payload._meta.eventId` e
 * deduplicamos por (webhook_id, event_id) — um mesmo evento de domínio reentregue
 * (replay de fila, retry do produtor) não duplica deliveries.
 *
 * Roda como owner (`getDb()`): fan-out é operação de plataforma sobre um tenant
 * conhecido (workspaceId vem do evento); o isolamento já está embutido no filtro.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';

const { outboundWebhooks } = schema;

export interface WebhookEvent {
  readonly workspaceId: string;
  /** Nome do evento assinável (catálogo em apps/api .../dev/webhooks WEBHOOK_EVENTS). */
  readonly event: string;
  /** Id estável da ocorrência (dedup por webhook). Ex.: `${messageId}:sent`. */
  readonly eventId: string;
  /** Corpo livre entregue ao cliente (será envelopado com _meta no dispatch). */
  readonly data: Record<string, unknown>;
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

  let created = 0;
  let deduped = 0;
  const payload = { ...evt.data, _meta: { eventId: evt.eventId, event: evt.event } };

  for (const sub of subscribers) {
    // Dedup por (webhook_id, _meta.eventId): só insere se ainda não existe.
    const inserted = await db.execute(sql`
      INSERT INTO outbound_webhook_deliveries
        (webhook_id, workspace_id, event, payload, status, next_attempt_at)
      SELECT ${sub.id}::uuid, ${evt.workspaceId}::uuid, ${evt.event}, ${JSON.stringify(payload)}::jsonb, 'pending', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM outbound_webhook_deliveries d
        WHERE d.webhook_id = ${sub.id}::uuid
          AND d.payload #>> '{_meta,eventId}' = ${evt.eventId}
      )
      RETURNING id
    `);
    if (Array.from(inserted).length > 0) created += 1;
    else deduped += 1;
  }

  return { matchedWebhooks: subscribers.length, created, deduped };
}
