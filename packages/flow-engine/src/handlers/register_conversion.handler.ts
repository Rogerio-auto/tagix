/**
 * Handler `register_conversion` (DATA_MODEL §10.7 hook / PIPELINE.md). F5-S14:
 * registra uma conversao a partir de uma regra de stage automation ou de um node
 * de flow. Resolve o conversion_type por key (no workspace), insere conversion_event
 * (source='flow') com dedup same-day tolerante (uq_conv_events_dedup -> idempotente).
 *
 * A flow-engine NAO pode importar apps/api (camada) -> usa @hm/db direto sob RLS,
 * espelhando o servico registerConversion de F5-S12 (mesmo contrato de dedup).
 * Sem contato na execucao, e no-op + log.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowHandler } from '../types';

const registerConversionSchema = z.object({
  conversionTypeKey: z.string().min(1),
  valueCents: z.number().int().min(0).optional(),
  note: z.string().max(1000).optional(),
});

const { conversionTypes, conversionEvents } = schema;
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

export const registerConversionHandler: FlowHandler<z.infer<typeof registerConversionSchema>> = {
  schema: registerConversionSchema,
  async execute(node, ctx) {
    const data = registerConversionSchema.parse(node.data);
    if (!ctx.contactId) {
      ctx.log('warn', 'register_conversion: execucao sem contactId; no-op', {
        nodeType: 'register_conversion',
      });
      return { status: 'SUCCESS' };
    }

    const outcome = await withWorkspace(ctx.workspaceId, async (tx) => {
      const [type] = await tx
        .select()
        .from(conversionTypes)
        .where(
          and(
            eq(conversionTypes.workspaceId, ctx.workspaceId),
            eq(conversionTypes.key, data.conversionTypeKey),
          ),
        )
        .limit(1);
      if (!type) return { kind: 'type_not_found' as const };
      if (type.valueRequired && data.valueCents === undefined) {
        return { kind: 'value_required' as const };
      }
      try {
        const [event] = await tx
          .insert(conversionEvents)
          .values({
            workspaceId: ctx.workspaceId,
            conversionTypeId: type.id,
            contactId: ctx.contactId!,
            conversationId: ctx.conversationId,
            valueCents: data.valueCents ?? null,
            currency: type.currency,
            note: data.note ?? null,
            source: 'flow',
            triggeredByFlowId: ctx.flowId,
          })
          .returning({ id: conversionEvents.id });
        return event ? { kind: 'created' as const, id: event.id } : { kind: 'deduped' as const };
      } catch (err: unknown) {
        if (isUniqueViolation(err)) return { kind: 'deduped' as const };
        throw err;
      }
    });

    if (outcome.kind === 'type_not_found') {
      ctx.log('error', 'register_conversion: tipo inexistente', {
        conversionTypeKey: data.conversionTypeKey,
      });
    } else if (outcome.kind === 'value_required') {
      ctx.log('error', 'register_conversion: tipo exige valor', {
        conversionTypeKey: data.conversionTypeKey,
      });
    } else if (outcome.kind === 'created') {
      ctx.log('info', 'register_conversion: conversao registrada', { conversionEventId: outcome.id });
    } else {
      ctx.log('info', 'register_conversion: conversao deduplicada (same-day)', {
        conversionTypeKey: data.conversionTypeKey,
      });
    }
    return { status: 'SUCCESS' };
  },
};
