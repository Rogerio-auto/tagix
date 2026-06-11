/**
 * Consentimento LGPD: opt-in / opt-out de marketing (CAMPAIGNS.md 9).
 *
 * Escreve nas colunas que JA existem em contacts (F1-S05): marketing_opt_in,
 * opt_in_method/source/at e opt_out_at/reason. Endpoints:
 *   POST /api/contacts/:id/opt-in       (contact.edit)
 *   POST /api/contacts/:id/opt-out      (contact.edit)
 *   POST /api/contacts/bulk-opt-in      (campaign.bulk_optin)  -- 9.2
 *
 * Exporta optInContact/optOutContact (services puros sobre tx) p/ reuso:
 * recipients bulk (F6-S04) e opt-out por keyword no inbound (F6-S07).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { contacts, campaignRecipients } = schema;

/** Metodos de opt-in aceitos pelo CHECK em contacts.opt_in_method. */
export const OPT_IN_METHODS = [
  'whatsapp',
  'website',
  'checkout',
  'import',
  'manual',
  'api',
] as const;
export type OptInMethod = (typeof OPT_IN_METHODS)[number];

export interface OptInArgs {
  readonly method: OptInMethod;
  readonly source?: string | null;
}

/** Marca opt-in (idempotente). Retorna o contato atualizado ou null se nao existe. */
export async function optInContact(
  tx: DbTx,
  contactId: string,
  args: OptInArgs,
): Promise<typeof contacts.$inferSelect | null> {
  const [updated] = await tx
    .update(contacts)
    .set({
      marketingOptIn: true,
      optInMethod: args.method,
      optInSource: args.source ?? null,
      optInAt: new Date(),
      optOutAt: null,
      optOutReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .returning();
  return updated ?? null;
}

export interface OptOutArgs {
  readonly reason?: string | null;
}

/**
 * Marca opt-out + remove o contato de recipients de campanhas MARKETING ainda
 * pendentes (status pending/sending -> opted_out). Retorna o contato ou null.
 */
export async function optOutContact(
  tx: DbTx,
  contactId: string,
  args: OptOutArgs = {},
): Promise<typeof contacts.$inferSelect | null> {
  const [updated] = await tx
    .update(contacts)
    .set({
      marketingOptIn: false,
      optOutAt: new Date(),
      optOutReason: args.reason ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .returning();
  if (!updated) return null;

  // Tira de campanhas futuras (qualquer recipient ainda nao concluido).
  await tx
    .update(campaignRecipients)
    .set({ status: 'opted_out' })
    .where(
      and(
        eq(campaignRecipients.contactId, contactId),
        inArray(campaignRecipients.status, ['pending', 'sending']),
      ),
    );
  return updated;
}

const optInSchema = z.object({
  method: z.enum(OPT_IN_METHODS),
  source: z.string().trim().max(200).nullish(),
});
const optOutSchema = z.object({ reason: z.string().trim().max(200).nullish() });
const bulkOptInSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(5000),
  method: z.enum(OPT_IN_METHODS).default('import'),
  source: z.string().trim().max(200).nullish(),
});

export function createContactsOptInRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('contact.edit')] as const;
  const bulkGuard = [requireAuth, withRLS, requireRole('campaign.bulk_optin')] as const;

  router.post('/api/contacts/:id/opt-in', ...editGuard, async (req: Request, res: Response) => {
    const parsed = optInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const updated = await req.scoped!((tx) =>
      optInContact(tx, id, { method: parsed.data.method, source: parsed.data.source ?? null }),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ contact: updated });
  });

  router.post('/api/contacts/:id/opt-out', ...editGuard, async (req: Request, res: Response) => {
    const parsed = optOutSchema.safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason ?? null : null;
    const id = param(req, 'id');
    const updated = await req.scoped!((tx) => optOutContact(tx, id, { reason }));
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ contact: updated });
  });

  router.post('/api/contacts/bulk-opt-in', ...bulkGuard, async (req: Request, res: Response) => {
    const parsed = bulkOptInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { contactIds, method, source } = parsed.data;
    const updated = await req.scoped!((tx) =>
      tx
        .update(contacts)
        .set({
          marketingOptIn: true,
          optInMethod: method,
          optInSource: source ?? null,
          optInAt: new Date(),
          optOutAt: null,
          optOutReason: null,
          updatedAt: new Date(),
        })
        .where(and(inArray(contacts.id, contactIds), isNull(contacts.deletedAt)))
        .returning({ id: contacts.id }),
    );
    res.json({ updated: updated.length });
  });

  return router;
}
