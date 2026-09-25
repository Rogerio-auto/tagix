/**
 * Suporte de teste F70-S17: os produtores da API gravam os eventos de domínio na
 * outbox, na transação do dado. Não é arquivo de teste (sem `.test.ts`).
 *
 * - {@link outboxEventsOf}: lê a outbox do workspace pela conexão do processo (dono
 *   do banco, membro de `hm_outbox_relay`), ou seja, por OUTRA transação que a do
 *   produtor. Uma linha visível aqui está commitada. Mesmo critério de
 *   `apps/workers/src/outbox/testing.ts`.
 *
 * O rollback forçado (mesma transação) fica em `./forced-rollback`.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { domainEventPayloadSchema, envelopeSchema } from '@hm/shared/mq';

export interface OutboxEventRow {
  readonly kind: string;
  readonly eventId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly status: string;
  /** Nome do evento (`envelope.type`). */
  readonly event: string;
  readonly workspaceId: string;
  readonly data: Record<string, unknown>;
}

/** Linhas da outbox de um workspace, na ordem de gravação. */
export async function outboxEventsOf(workspaceId: string): Promise<OutboxEventRow[]> {
  const { outbox } = schema;
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(eq(outbox.workspaceId, workspaceId))
    .orderBy(asc(outbox.id));
  return rows.map((r) => {
    const envelope = envelopeSchema.parse(r.envelope);
    const payload = domainEventPayloadSchema.parse(envelope.payload);
    return {
      kind: r.kind,
      eventId: r.eventId,
      exchange: r.exchange,
      routingKey: r.routingKey,
      status: r.status,
      event: envelope.type,
      workspaceId: envelope.workspaceId,
      data: payload.data,
    };
  });
}

/** Linhas da outbox de um workspace que carregam o evento dado. */
export async function outboxEventsNamed(
  workspaceId: string,
  event: string,
): Promise<OutboxEventRow[]> {
  return (await outboxEventsOf(workspaceId)).filter((r) => r.event === event);
}
