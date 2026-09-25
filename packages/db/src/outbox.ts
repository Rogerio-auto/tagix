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
 * Idempotente por `(workspace_id, event_id)`: `ON CONFLICT DO NOTHING` — gravar o
 * mesmo evento de novo (retentativa do produtor, dois caminhos disputando a mesma
 * criação) não duplica e, principalmente, não aborta a transação de negócio. O mesmo
 * `event_id` em outro workspace é outra linha (F70-S24): um tenant não silencia o
 * evento de outro.
 *
 * O ON CONFLICT vai SEM alvo, de propósito. Com alvo, o Postgres exige SELECT nas
 * colunas árbitro e aplica a policy de SELECT à linha nova; sem alvo, basta INSERT —
 * e o hm_app não lê NADA da outbox (0091). É equivalente porque o único índice único
 * além da PK (identity, nunca colide) é `uq_outbox_workspace_event`; o teste de
 * constraints dos workers trava esse conjunto. Sem RETURNING pelo mesmo motivo.
 *
 * Os CHECKs da 0091 recusam (23514) a mensagem cujo envelope é de outro workspace ou
 * cujo destino não é uma fila/routing key aceita — a transação do produtor cai.
 *
 * As mensagens vêm prontas dos construtores de `@hm/shared/mq`
 * (`domainEventsOutbox`, `queueJobOutbox`), que já validaram o envelope.
 */
import type { OutboxMessage } from '@hm/shared/mq';
import type { DbTx } from './client';
import { outbox } from './schema/outbox';

/** Canal do LISTEN/NOTIFY que acorda o relay (disparado pelo trigger da 0086). */
export const OUTBOX_NOTIFY_CHANNEL = 'hm_outbox';

/**
 * Grava as mensagens na outbox, na transação `tx`. Devolve quantas linhas entraram
 * (as repetidas pelo `(workspace_id, event_id)` não contam).
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
    // Sem alvo: ver o cabeçalho (privilégio mínimo do hm_app).
    .onConflictDoNothing();
  return result.count;
}

function isMessageList(
  value: OutboxMessage | readonly OutboxMessage[],
): value is readonly OutboxMessage[] {
  return Array.isArray(value);
}
