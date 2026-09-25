/**
 * Leitura da outbox para os testes dos produtores (F70-S16). Só teste importa isto.
 *
 * Lê pela conexão do processo (papel dos workers, membro de `hm_outbox_relay`) — ou
 * seja, por OUTRA transação que a do produtor: uma linha visível aqui está commitada.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { domainEventPayloadSchema, envelopeSchema, type Envelope } from '@hm/shared/mq';

export interface OutboxTestRow {
  readonly id: number;
  readonly kind: string;
  readonly eventId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly status: string;
  readonly attempts: number;
  readonly envelope: Envelope;
}

/** O evento de domínio de uma linha, no formato do rascunho do catálogo. */
export interface OutboxTestEvent {
  readonly event: string;
  readonly workspaceId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

/** Linhas da outbox de um workspace, na ordem de gravação. */
export async function outboxRowsOf(workspaceId: string): Promise<OutboxTestRow[]> {
  const { outbox } = schema;
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(eq(outbox.workspaceId, workspaceId))
    .orderBy(asc(outbox.id));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    eventId: r.eventId,
    exchange: r.exchange,
    routingKey: r.routingKey,
    status: r.status,
    attempts: r.attempts,
    envelope: envelopeSchema.parse(r.envelope),
  }));
}

/** Converte uma linha `event` no evento de domínio que ela carrega. */
export function eventOf(row: OutboxTestRow): OutboxTestEvent {
  const payload = domainEventPayloadSchema.parse(row.envelope.payload);
  return {
    event: row.envelope.type,
    workspaceId: row.envelope.workspaceId,
    eventId: payload.eventId,
    occurredAt: payload.occurredAt,
    data: payload.data,
  };
}

/** Eventos de domínio gravados para o workspace, na ordem. */
export async function outboxEventsOf(workspaceId: string): Promise<OutboxTestEvent[]> {
  const rows = await outboxRowsOf(workspaceId);
  return rows.filter((r) => r.kind === 'event').map(eventOf);
}
