/**
 * Eventos de conversao (DATA_MODEL §10.7, DASHBOARD.md §13).
 *
 * Endpoints sob /api/conversions, RLS via req.scoped:
 *   POST   /api/conversions            registra (deal.convert)
 *   GET    /api/conversions            lista filtrada (deal.convert)
 *   POST   /api/conversions/:id/cancel cancela (deal.cancel_conversion)
 *
 * Registro usa o servico unico registerConversion (register.ts) — dedup same-day
 * vira 409 com mensagem util; valor obrigatorio (value_required) -> 422.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from './types';
import { registerConversion } from './register';

const { conversionEvents } = schema;

const registerSchema = z
  .object({
    conversionTypeId: z.string().uuid().optional(),
    conversionTypeKey: z.string().trim().min(1).optional(),
    contactId: z.string().uuid(),
    conversationId: z.string().uuid().nullish(),
    dealId: z.string().uuid().nullish(),
    valueCents: z.number().int().min(0).nullish(),
    currency: z.string().trim().length(3).optional(),
    note: z.string().trim().max(1000).nullish(),
    source: z.enum(['manual', 'deal_won', 'api']).default('manual'),
    attributedCampaignId: z.string().uuid().nullish(),
    attributedChannelId: z.string().uuid().nullish(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine((d) => d.conversionTypeId || d.conversionTypeKey, {
    message: 'conversionTypeId ou conversionTypeKey e obrigatorio',
  });

const listQuerySchema = z.object({
  conversionTypeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  memberId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export function createConversionEventsRouter(): Router {
  const router = Router();
  const convertGuard = [requireAuth, withRLS, requireRole('deal.convert')] as const;
  const cancelGuard = [requireAuth, withRLS, requireRole('deal.cancel_conversion')] as const;

  // POST /api/conversions — registro manual.
  router.post('/api/conversions', ...convertGuard, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    const result = await req.scoped!((tx) =>
      registerConversion(tx, {
        workspaceId,
        conversionTypeId: d.conversionTypeId,
        conversionTypeKey: d.conversionTypeKey,
        contactId: d.contactId,
        conversationId: d.conversationId ?? null,
        dealId: d.dealId ?? null,
        valueCents: d.valueCents ?? null,
        currency: d.currency,
        note: d.note ?? null,
        source: d.source,
        triggeredByMemberId: req.auth!.member.id,
        attributedCampaignId: d.attributedCampaignId ?? null,
        attributedChannelId: d.attributedChannelId ?? null,
        occurredAt: d.occurredAt ? new Date(d.occurredAt) : undefined,
      }),
    );
    switch (result.kind) {
      case 'created':
        res.status(201).json({ conversion: result.event });
        return;
      case 'deduped':
        res
          .status(409)
          .json({ error: 'duplicate_conversion', message: 'Conversao ja registrada hoje para este contato e tipo.' });
        return;
      case 'type_not_found':
        res.status(404).json({ error: 'conversion_type_not_found' });
        return;
      case 'value_required':
        res.status(422).json({ error: 'value_required', message: 'Este tipo de conversao exige valor.' });
        return;
    }
  });

  // GET /api/conversions — lista filtrada (so nao-cancelados por default).
  router.get('/api/conversions', ...convertGuard, async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const q = parsed.data;
    const filters = [isNull(conversionEvents.cancelledAt)];
    if (q.conversionTypeId) filters.push(eq(conversionEvents.conversionTypeId, q.conversionTypeId));
    if (q.memberId) filters.push(eq(conversionEvents.triggeredByMemberId, q.memberId));
    if (q.agentId) filters.push(eq(conversionEvents.triggeredByAgentId, q.agentId));
    if (q.from) filters.push(gte(conversionEvents.occurredAt, new Date(q.from)));
    if (q.to) filters.push(lte(conversionEvents.occurredAt, new Date(q.to)));
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(conversionEvents)
        .where(and(...filters))
        .orderBy(desc(conversionEvents.occurredAt)),
    );
    res.json({ conversions: rows });
  });

  // POST /api/conversions/:id/cancel — cancela (soft).
  router.post('/api/conversions/:id/cancel', ...cancelGuard, async (req: Request, res: Response) => {
    const parsed = cancelSchema.safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(conversionEvents)
        .set({ cancelledAt: new Date(), cancelledReason: reason ?? null })
        .where(and(eq(conversionEvents.id, id), isNull(conversionEvents.cancelledAt)))
        .returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ conversion: updated });
  });

  return router;
}
