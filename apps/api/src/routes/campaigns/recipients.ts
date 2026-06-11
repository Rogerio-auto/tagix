/**
 * Recipients de campanha: import em massa + opt-in batch (CAMPAIGNS.md 12.3, 13).
 * POST /api/campaigns/:id/recipients/bulk        (campaign.upload_recipients)
 * POST /api/campaigns/:id/recipients/bulk-opt-in (campaign.bulk_optin)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { contacts, campaigns, campaignRecipients } = schema;

const E164 = /^\+[1-9]\d{6,14}$/;
export function isE164(phone: string): boolean {
  return E164.test(phone.trim());
}

const rowSchema = z.object({
  phone: z.string().trim().min(1),
  name: z.string().trim().max(200).optional(),
  optIn: z.boolean().optional(),
});

const bulkSchema = z
  .object({
    rows: z.array(rowSchema).max(50000).optional(),
    csv: z.string().max(5000000).optional(),
    source: z.string().trim().max(200).optional(),
    optInOnImport: z.boolean().optional(),
  })
  .refine((d) => d.rows || d.csv, { message: 'rows ou csv e obrigatorio' });

interface ParsedRow {
  phone: string;
  name?: string;
  optIn?: boolean;
}

export function parseCsv(csv: string): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf('phone');
  const nameIdx = header.indexOf('name');
  const optInIdx = header.findIndex((h) => h === 'opt_in' || h === 'optin');
  const out: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',').map((c) => c.trim());
    const phone = phoneIdx >= 0 ? cols[phoneIdx] ?? '' : cols[0] ?? '';
    if (!phone) continue;
    const row: ParsedRow = { phone };
    if (nameIdx >= 0 && cols[nameIdx]) row.name = cols[nameIdx];
    if (optInIdx >= 0) {
      const v = (cols[optInIdx] ?? '').toLowerCase();
      row.optIn = v === 'true' || v === '1' || v === 'sim' || v === 'yes';
    }
    out.push(row);
  }
  return out;
}

export interface BulkReportLine {
  phone: string;
  status: 'created' | 'reused' | 'skipped';
  reason?: string;
}

export interface BulkResult {
  total: number;
  recipientsAdded: number;
  contactsCreated: number;
  contactsReused: number;
  invalid: number;
  report: BulkReportLine[];
}

export async function importRecipients(
  tx: DbTx,
  args: {
    workspaceId: string;
    campaignId: string;
    rows: ParsedRow[];
    source?: string;
    optInOnImport: boolean;
  },
): Promise<BulkResult> {
  const report: BulkReportLine[] = [];
  let contactsCreated = 0;
  let contactsReused = 0;
  let recipientsAdded = 0;
  let invalid = 0;

  for (const row of args.rows) {
    const phone = row.phone.trim();
    if (!isE164(phone)) {
      invalid++;
      report.push({ phone, status: 'skipped', reason: 'phone_nao_e_E164' });
      continue;
    }

    const [existing] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.phone, phone), isNull(contacts.deletedAt)));

    let contactId: string;
    if (existing) {
      contactId = existing.id;
      contactsReused++;
      if (args.optInOnImport) {
        await tx
          .update(contacts)
          .set({
            marketingOptIn: true,
            optInMethod: 'import',
            optInSource: args.source ?? null,
            optInAt: new Date(),
            optOutAt: null,
            optOutReason: null,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, contactId));
      }
      report.push({ phone, status: 'reused' });
    } else {
      const [created] = await tx
        .insert(contacts)
        .values({
          workspaceId: args.workspaceId,
          phone,
          displayName: row.name ?? null,
          source: 'campaign_import',
          marketingOptIn: args.optInOnImport ? true : false,
          optInMethod: args.optInOnImport ? 'import' : null,
          optInSource: args.optInOnImport ? args.source ?? null : null,
          optInAt: args.optInOnImport ? new Date() : null,
        })
        .returning({ id: contacts.id });
      if (!created) continue;
      contactId = created.id;
      contactsCreated++;
      report.push({ phone, status: 'created' });
    }

    const inserted = await tx
      .insert(campaignRecipients)
      .values({ workspaceId: args.workspaceId, campaignId: args.campaignId, contactId })
      .onConflictDoNothing({
        target: [campaignRecipients.campaignId, campaignRecipients.contactId],
      })
      .returning({ id: campaignRecipients.id });
    if (inserted.length > 0) recipientsAdded++;
  }

  return {
    total: args.rows.length,
    recipientsAdded,
    contactsCreated,
    contactsReused,
    invalid,
    report,
  };
}

export function createCampaignRecipientsRouter(): Router {
  const router = Router();
  const uploadGuard = [requireAuth, withRLS, requireRole('campaign.upload_recipients')] as const;
  const bulkOptInGuard = [requireAuth, withRLS, requireRole('campaign.bulk_optin')] as const;

  router.post(
    '/api/campaigns/:id/recipients/bulk',
    ...uploadGuard,
    async (req: Request, res: Response) => {
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const id = param(req, 'id');
      const workspaceId = req.auth!.workspace.id;
      const rows: ParsedRow[] = parsed.data.rows ?? parseCsv(parsed.data.csv ?? '');

      const outcome = await req.scoped!(async (tx) => {
        const [campaign] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.id, id));
        if (!campaign) return null;
        return importRecipients(tx, {
          workspaceId,
          campaignId: id,
          rows,
          source: parsed.data.source,
          optInOnImport: parsed.data.optInOnImport ?? false,
        });
      });
      if (!outcome) {
        res.sendStatus(404);
        return;
      }
      res.status(201).json(outcome);
    },
  );

  router.post(
    '/api/campaigns/:id/recipients/bulk-opt-in',
    ...bulkOptInGuard,
    async (req: Request, res: Response) => {
      const schemaBody = z.object({ source: z.string().trim().max(200).nullish() });
      const parsed = schemaBody.safeParse(req.body ?? {});
      const source = parsed.success ? parsed.data.source ?? null : null;
      const id = param(req, 'id');

      const outcome = await req.scoped!(async (tx) => {
        const recipients = await tx
          .select({ contactId: campaignRecipients.contactId })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, id));
        if (recipients.length === 0) return { updated: 0 };
        const ids = recipients.map((r) => r.contactId);
        const updated = await tx
          .update(contacts)
          .set({
            marketingOptIn: true,
            optInMethod: 'import',
            optInSource: source,
            optInAt: new Date(),
            optOutAt: null,
            optOutReason: null,
            updatedAt: new Date(),
          })
          .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
          .returning({ id: contacts.id });
        return { updated: updated.length };
      });
      res.json(outcome);
    },
  );

  return router;
}
