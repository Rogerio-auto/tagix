/**
 * Dedup de webhooks inbound na borda (F1-S02, LIVECHAT.md §1 passo 2).
 *
 * Insere o evento em `webhook_events` com a chave `(provider, external_event_id)`.
 * Como há um índice único nessa chave, `onConflictDoNothing` é atômico: a
 * primeira chegada insere uma linha (retorna `true` = primeira vez); chegadas
 * repetidas não inserem (retorna `false` = duplicata) e o caller NÃO re-publica.
 *
 * É platform-level (sem workspace_id) — a verificação acontece ANTES da
 * resolução de workspace/channel pelo worker. `raw_payload` mantido 30d.
 */
import { getDb, schema } from '@hm/db';
import type { ChannelProvider } from '@hm/shared';

export interface DedupInput {
  readonly provider: ChannelProvider;
  readonly externalEventId: string;
  readonly rawPayload: Record<string, unknown>;
}

/**
 * Registra o evento e indica se é a PRIMEIRA vez que ele é visto.
 *
 * @returns `true` se inserido agora (primeira vez → publicar);
 *          `false` se já existia (duplicata → ignorar).
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
