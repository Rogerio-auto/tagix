/**
 * Servico de registro de conversao (F5-S12). Ponto UNICO de criacao de
 * conversion_events — reusado por:
 *   - POST /api/conversions (registro manual, events.ts),
 *   - o agent tool register_conversion (F2-S20, fecha o stub "ate F5"),
 *   - as automacoes de stage/tag (F5-S14).
 *
 * Resolve o conversion_type por key (dentro do workspace), valida valor
 * obrigatorio (value_required), e trata o dedup same-day (uq_conv_events_dedup)
 * de forma idempotente: retorna { deduped: true } em vez de estourar.
 *
 * Roda SEMPRE dentro de uma transacao RLS (`tx` injetado pelo caller).
 */
import { and, eq } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const { conversionTypes, conversionEvents } = schema;

export type ConversionSource =
  | 'manual'
  | 'deal_won'
  | 'tag_added'
  | 'agent_tool'
  | 'api'
  | 'webhook'
  | 'flow';

export interface RegisterConversionInput {
  workspaceId: string;
  conversionTypeId?: string;
  conversionTypeKey?: string;
  contactId: string;
  conversationId?: string | null;
  dealId?: string | null;
  valueCents?: number | null;
  currency?: string;
  note?: string | null;
  source: ConversionSource;
  triggeredByMemberId?: string | null;
  triggeredByAgentId?: string | null;
  triggeredByFlowId?: string | null;
  attributedCampaignId?: string | null;
  attributedChannelId?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

export type RegisterConversionResult =
  | { kind: 'created'; event: typeof conversionEvents.$inferSelect }
  | { kind: 'deduped' }
  | { kind: 'type_not_found' }
  | { kind: 'value_required' };

/** Codigo Postgres de unique_violation. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

export async function registerConversion(
  tx: DbTx,
  input: RegisterConversionInput,
): Promise<RegisterConversionResult> {
  // Resolve o tipo (por id ou key).
  const typeRow = await (async () => {
    if (input.conversionTypeId) {
      const [r] = await tx
        .select()
        .from(conversionTypes)
        .where(eq(conversionTypes.id, input.conversionTypeId))
        .limit(1);
      return r ?? null;
    }
    if (input.conversionTypeKey) {
      const [r] = await tx
        .select()
        .from(conversionTypes)
        .where(
          and(
            eq(conversionTypes.workspaceId, input.workspaceId),
            eq(conversionTypes.key, input.conversionTypeKey),
          ),
        )
        .limit(1);
      return r ?? null;
    }
    return null;
  })();

  if (!typeRow) return { kind: 'type_not_found' };

  if (typeRow.valueRequired && (input.valueCents === undefined || input.valueCents === null)) {
    return { kind: 'value_required' };
  }

  try {
    const [event] = await tx
      .insert(conversionEvents)
      .values({
        workspaceId: input.workspaceId,
        conversionTypeId: typeRow.id,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        dealId: input.dealId ?? null,
        valueCents: input.valueCents ?? null,
        currency: input.currency ?? typeRow.currency,
        note: input.note ?? null,
        source: input.source,
        triggeredByMemberId: input.triggeredByMemberId ?? null,
        triggeredByAgentId: input.triggeredByAgentId ?? null,
        triggeredByFlowId: input.triggeredByFlowId ?? null,
        attributedCampaignId: input.attributedCampaignId ?? null,
        attributedChannelId: input.attributedChannelId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        metadata: input.metadata ?? {},
      })
      .returning();
    if (!event) return { kind: 'deduped' };
    return { kind: 'created', event };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return { kind: 'deduped' };
    throw err;
  }
}
