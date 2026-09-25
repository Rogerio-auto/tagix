/**
 * Gravação na outbox transacional (F70-S16).
 *
 * `enqueueOutbox(tx, msgs)` grava as mensagens NA transação do chamador: commit
 * publica (o relay leva ao RabbitMQ), rollback apaga junto. Funciona nos dois papéis
 * de transação do sistema:
 *  - `withWorkspace` (hm_app, RLS): a policy `outbox_tenant_insert` exige que a linha
 *    seja do workspace da transação;
 *  - `getDb().transaction` (papel de conexão dos workers).
 *
 * Idempotente pelo `event_id`: `ON CONFLICT DO NOTHING` — gravar o mesmo evento de
 * novo (retentativa do produtor, dois caminhos disputando a mesma criação) não
 * duplica e, principalmente, não aborta a transação de negócio. Sem RETURNING: o
 * hm_app não lê a outbox.
 *
 * As mensagens vêm prontas dos construtores de `@hm/shared/mq`
 * (`domainEventsOutbox`, `queueJobOutbox`), que já validaram o envelope.
 */
import type { OutboxMessage } from '@hm/shared/mq';
import { getDb, type DbTx } from './client';
import { outbox } from './schema/outbox';

/** Canal do LISTEN/NOTIFY que acorda o relay (disparado pelo trigger da 0086). */
export const OUTBOX_NOTIFY_CHANNEL = 'hm_outbox';

/**
 * Grava as mensagens na outbox, na transação `tx`. Devolve quantas linhas entraram
 * (as repetidas pelo `event_id` não contam).
 */
export async function enqueueOutbox(
  tx: DbTx,
  messages: OutboxMessage | readonly OutboxMessage[],
): Promise<number> {
  const list = isMessageList(messages) ? messages : [messages];
  if (list.length === 0) return 0;
  const result = await tx
    .insert(outbox)
    .values(
      list.map((m) => ({
        eventId: m.eventId,
        kind: m.kind,
        workspaceId: m.envelope.workspaceId,
        exchange: m.exchange,
        routingKey: m.routingKey,
        envelope: { ...m.envelope },
      })),
    )
    .onConflictDoNothing({ target: outbox.eventId });
  return result.count;
}

/**
 * Grava numa transação própria (papel de conexão). Para o produtor que não tem
 * transação a compartilhar — a mutação dele já está commitada (ex.: o status de envio
 * do outbound, gravado por uma porta de persistência). Ainda assim ganha o relay com
 * confirms e retentativa, e o `event_id` deduplica a regravação numa reentrega.
 */
export async function enqueueOutboxStandalone(
  messages: OutboxMessage | readonly OutboxMessage[],
): Promise<number> {
  const list = isMessageList(messages) ? messages : [messages];
  if (list.length === 0) return 0;
  return getDb().transaction((tx) => enqueueOutbox(tx, list));
}

function isMessageList(
  value: OutboxMessage | readonly OutboxMessage[],
): value is readonly OutboxMessage[] {
  return Array.isArray(value);
}
