/**
 * Repo de payment_events (F41-S02 / PAYMENTS_ABACATEPAY.md §2 e §4).
 *
 * Ledger + idempotência de DOMÍNIO do gateway de pagamento. A ingestão do webhook
 * roda na BORDA da API (antes da resolução de tenant, como worker-inbound) → usa
 * `getDb()` (owner, bypassa RLS), espelhando o fluxo de `webhook_events`. O insert
 * é idempotente por `(provider, external_event_id)`: um replay do mesmo evento NÃO
 * cria nova linha (ON CONFLICT DO NOTHING no índice único).
 *
 * `markProcessed` carimba `processed_at` após a transição de domínio
 * (subscription_status + audit_logs) ser aplicada — permite reprocessar eventos
 * recebidos-mas-não-processados de forma segura.
 *
 * `listByWorkspace` é a leitura do billing portal: roda sob um DbTx escopado
 * (`withWorkspace`) → a RLS garante o isolamento (cinto-e-suspensório com o filtro).
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import { paymentEvents, type NewPaymentEvent, type PaymentEvent } from '../schema';

type RecordEventInput = {
  provider: string;
  externalEventId: string;
  eventType: string;
  rawPayload: Record<string, unknown>;
  workspaceId?: string | null;
  subscriptionExternalId?: string | null;
  amountCents?: number | null;
  status?: string | null;
};

export const paymentEventsRepo = {
  /**
   * Grava um evento de pagamento de forma idempotente por (provider, event id).
   * Retorna a linha (nova OU já-existente). Replay do mesmo evento devolve a
   * linha original sem duplicar — o caller deve checar `processed_at` para decidir
   * se ainda precisa aplicar a transição de domínio.
   *
   * Owner-level (bypassa RLS): a ingestão acontece antes/independente do escopo de
   * tenant, igual à dedup de borda em `webhook_events`.
   */
  async record(input: RecordEventInput): Promise<PaymentEvent> {
    const values: NewPaymentEvent = {
      provider: input.provider,
      externalEventId: input.externalEventId,
      eventType: input.eventType,
      rawPayload: input.rawPayload,
      workspaceId: input.workspaceId ?? null,
      subscriptionExternalId: input.subscriptionExternalId ?? null,
      amountCents: input.amountCents ?? null,
      status: input.status ?? null,
    };

    const db = getDb();
    const [inserted] = await db
      .insert(paymentEvents)
      .values(values)
      .onConflictDoNothing({
        target: [paymentEvents.provider, paymentEvents.externalEventId],
      })
      .returning();
    if (inserted) return inserted;

    // Conflito (replay): devolve a linha já existente.
    const [existing] = await db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.provider, input.provider),
          eq(paymentEvents.externalEventId, input.externalEventId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('payment_events: insert idempotente sem linha resultante.');
    return existing;
  },

  /** True se um evento (provider, external id) já foi gravado. */
  async exists(provider: string, externalEventId: string): Promise<boolean> {
    const [row] = await getDb()
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.provider, provider),
          eq(paymentEvents.externalEventId, externalEventId),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  /** Carimba processed_at após aplicar a transição de domínio. Idempotente. */
  async markProcessed(id: string, processedAt: Date = new Date()): Promise<PaymentEvent | null> {
    const [row] = await getDb()
      .update(paymentEvents)
      .set({ processedAt })
      .where(eq(paymentEvents.id, id))
      .returning();
    return row ?? null;
  },

  /**
   * Histórico de eventos do workspace (billing portal). DEVE rodar sob um DbTx
   * escopado (`withWorkspace`) — a RLS isola o tenant; o filtro explícito é o
   * suspensório. Mais recentes primeiro.
   */
  async listByWorkspace(tx: DbTx, workspaceId: string, limit = 100): Promise<PaymentEvent[]> {
    return tx
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.workspaceId, workspaceId))
      .orderBy(desc(paymentEvents.receivedAt))
      .limit(limit);
  },
};
