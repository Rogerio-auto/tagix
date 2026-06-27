/**
 * Dedup de webhooks inbound na borda (F1-S02, LIVECHAT.md §1 passo 2).
 *
 * A chave de dedup é `(provider, external_event_id)` (índice único), o id que o
 * provider atribui ao evento (wamid no WhatsApp, mid no Instagram, id no WAHA).
 * É platform-level (sem workspace_id) — a verificação acontece ANTES da
 * resolução de workspace/channel pelo worker. `raw_payload` mantido 30d.
 *
 * Ordem à prova de perda (F52-S02): a borda primeiro CONSULTA se o evento já foi
 * processado (`hasWebhookEvent`); só MARCA o dedup (`registerWebhookEvent`)
 * DEPOIS de confirmar o enqueue. Assim uma falha de enqueue nunca grava o dedup
 * e o provider pode reentregar o evento. `onConflictDoNothing` torna a marcação
 * atômica contra reentregas concorrentes.
 */
import { and, eq } from 'drizzle-orm';
import { Counter } from 'prom-client';
import { getDb, schema } from '@hm/db';
import type { ChannelProvider } from '@hm/shared';
import { getMetricsRegistry } from '../../middlewares/metrics';

export interface DedupInput {
  readonly provider: ChannelProvider;
  readonly externalEventId: string;
  readonly rawPayload: Record<string, unknown>;
}

/**
 * Contador de reentregas: quantas vezes o dedup viu um evento que JÁ havia sido
 * processado (o provider reentregou). Alta taxa pode indicar latência/erro a
 * montante ou backpressure recorrente. Exposto no mesmo `/metrics` da API.
 */
const webhookRedeliveryTotal = new Counter({
  name: 'hm_webhook_redelivery_total',
  help: 'Reentregas de webhook detectadas pelo dedup (evento já processado), por provider.',
  labelNames: ['provider'] as const,
  registers: [getMetricsRegistry()],
});

/** Incrementa o contador de reentrega para o provider dado. */
export function recordWebhookRedelivery(provider: ChannelProvider): void {
  webhookRedeliveryTotal.inc({ provider });
}

/**
 * Consulta (SEM inserir) se o evento já foi processado. Usado ANTES do enqueue
 * para detectar reentrega do provider e não republicar. A marcação do dedup só
 * ocorre depois, via `registerWebhookEvent`, quando o enqueue confirma.
 *
 * @returns `true` se o evento já existe (reentrega → não republicar).
 */
export async function hasWebhookEvent(input: DedupInput): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.webhookEvents.id })
    .from(schema.webhookEvents)
    .where(
      and(
        eq(schema.webhookEvents.provider, input.provider),
        eq(schema.webhookEvents.externalEventId, input.externalEventId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Marca o evento como processado — chamar SOMENTE após o enqueue confirmado.
 *
 * Atômico via `onConflictDoNothing`: se uma reentrega concorrente já marcou,
 * retorna `false` (sem erro). Marcar só após o enqueue garante que uma falha de
 * publish nunca bloqueie a reentrega do provider.
 *
 * @returns `true` se marcado agora; `false` se já existia (corrida concorrente).
 */
export async function registerWebhookEvent(input: DedupInput): Promise<boolean> {
  const inserted = await getDb()
    .insert(schema.webhookEvents)
    .values({
      provider: input.provider,
      externalEventId: input.externalEventId,
      rawPayload: input.rawPayload,
    })
    .onConflictDoNothing({
      target: [schema.webhookEvents.provider, schema.webhookEvents.externalEventId],
    })
    .returning({ id: schema.webhookEvents.id });

  return inserted.length > 0;
}
