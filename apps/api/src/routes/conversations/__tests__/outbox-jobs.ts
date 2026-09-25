/**
 * Suporte de teste F70-S21: jobs de fila gravados na outbox (`kind = 'job'`). Não é
 * arquivo de teste (sem `.test.ts`).
 *
 * Lê pela conexão do processo (dono do banco, membro de `hm_outbox_relay`), ou seja,
 * por OUTRA transação que a do produtor: uma linha visível aqui está commitada. Mesmo
 * critério de `../../deals/__tests__/outbox.ts` (eventos de domínio).
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { envelopeSchema } from '@hm/shared/mq';

export interface OutboxJobRow {
  readonly eventId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly type: string;
  readonly envelopeId: string;
  readonly envelopeWorkspaceId: string;
  readonly payload: Record<string, unknown>;
}

/** Jobs da outbox do workspace, na ordem de gravação. */
export async function outboxJobsOf(workspaceId: string): Promise<OutboxJobRow[]> {
  const { outbox } = schema;
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(and(eq(outbox.workspaceId, workspaceId), eq(outbox.kind, 'job')))
    .orderBy(asc(outbox.id));
  return rows.map((r) => {
    const envelope = envelopeSchema.parse(r.envelope);
    return {
      eventId: r.eventId,
      exchange: r.exchange,
      routingKey: r.routingKey,
      type: envelope.type,
      envelopeId: envelope.id,
      envelopeWorkspaceId: envelope.workspaceId,
      payload: envelope.payload as Record<string, unknown>,
    };
  });
}

/** Jobs do workspace cujo payload aponta a mensagem dada. */
export async function outboxJobsOfMessage(
  workspaceId: string,
  messageId: string,
): Promise<OutboxJobRow[]> {
  return (await outboxJobsOf(workspaceId)).filter((j) => j.payload['messageId'] === messageId);
}
