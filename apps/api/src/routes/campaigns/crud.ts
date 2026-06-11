/**
 * CRUD de campanhas + steps/followups + validate (CAMPAIGNS.md 4, 5, 13).
 * Guards: list/get -> campaign.list; create/update/delete/steps/followups -> campaign.edit.
 * RLS via req.scoped. Toda input via Zod. validate roda o validador puro com ports reais.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';
import { validateCampaign } from './validate';
import { buildValidationCampaign, loadCampaignChannel, makeGraphPorts } from './service';

const { campaigns, campaignSteps, campaignFollowups } = schema;

const windowSchema = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
const sendWindowsSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).optional(),
  windows: z.array(windowSchema).optional(),
});

const createSchema = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(['broadcast', 'drip', 'triggered']),
  timezone: z.string().trim().min(1).optional(),
  startAt: z.string().datetime().nullish(),
  endAt: z.string().datetime().nullish(),
  sendWindows: sendWindowsSchema.optional(),
  rateLimitPerMinute: z.number().int().min(1).max(600).optional(),
  dailyLimit: z.number().int().min(1).nullish(),
  autoHandoffOnReply: z.boolean().optional(),
  aiHandoffAgentId: z.string().uuid().nullish(),
});

const updateSchema = createSchema.partial().omit({ channelId: true });

const stepSchema = z.object({
  position: z.number().int().min(0),
  templateName: z.string().trim().min(1).max(200),
  languageCode: z.string().trim().min(2).max(10).optional(),
  templateComponents: z.array(z.record(z.string(), z.unknown())).optional(),
  delaySeconds: z.number().int().min(0).optional(),
  stopOnReply: z.boolean().optional(),
});
const stepsSchema = z.object({ steps: z.array(stepSchema).min(1) });

const followupSchema = z.object({
  triggerEvent: z.enum(['on_reply', 'on_no_reply', 'on_delivered']),
  delayMinutes: z.number().int().min(0).optional(),
  templateName: z.string().trim().min(1).max(200),
  languageCode: z.string().trim().min(2).max(10).optional(),
  templateComponents: z.array(z.record(z.string(), z.unknown())).optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
const followupsSchema = z.object({ followups: z.array(followupSchema) });

export function createCampaignsCrudRouter(): Router {
  const router = Router();
  const listGuard = [requireAuth, withRLS, requireRole('campaign.list')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('campaign.edit')] as const;

  router.get('/api/campaigns', ...listGuard, async (req: Request, res: Response) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const filters = status ? [eq(campaigns.status, status)] : [];
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(campaigns)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(campaigns.createdAt)),
    );
    res.json({ campaigns: rows });
  });

  router.get('/api/campaigns/:id', ...listGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
      if (!campaign) return null;
      const steps = await tx
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, id))
        .orderBy(asc(campaignSteps.position));
      const followups = await tx
        .select()
        .from(campaignFollowups)
        .where(eq(campaignFollowups.campaignId, id))
        .orderBy(asc(campaignFollowups.position));
      return { campaign, steps, followups };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  });

  router.post('/api/campaigns', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const [created] = await req.scoped!((tx) =>
      tx
        .insert(campaigns)
        .values({
          workspaceId,
          channelId: d.channelId,
          name: d.name,
          type: d.type,
          status: 'draft',
          timezone: d.timezone ?? 'America/Sao_Paulo',
          startAt: d.startAt ? new Date(d.startAt) : null,
          endAt: d.endAt ? new Date(d.endAt) : null,
          sendWindows: (d.sendWindows ?? { enabled: false }) as schema.SendWindows,
          rateLimitPerMinute: d.rateLimitPerMinute ?? 30,
          dailyLimit: d.dailyLimit ?? 1000,
          autoHandoffOnReply: d.autoHandoffOnReply ?? true,
          aiHandoffAgentId: d.aiHandoffAgentId ?? null,
          createdBy: req.auth!.member.id,
        })
        .returning(),
    );
    res.status(201).json({ campaign: created });
  });

  router.put('/api/campaigns/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const d = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (d.name !== undefined) patch['name'] = d.name;
    if (d.type !== undefined) patch['type'] = d.type;
    if (d.timezone !== undefined) patch['timezone'] = d.timezone;
    if (d.startAt !== undefined) patch['startAt'] = d.startAt ? new Date(d.startAt) : null;
    if (d.endAt !== undefined) patch['endAt'] = d.endAt ? new Date(d.endAt) : null;
    if (d.sendWindows !== undefined) patch['sendWindows'] = d.sendWindows as schema.SendWindows;
    if (d.rateLimitPerMinute !== undefined) patch['rateLimitPerMinute'] = d.rateLimitPerMinute;
    if (d.dailyLimit !== undefined) patch['dailyLimit'] = d.dailyLimit;
    if (d.autoHandoffOnReply !== undefined) patch['autoHandoffOnReply'] = d.autoHandoffOnReply;
    if (d.aiHandoffAgentId !== undefined) patch['aiHandoffAgentId'] = d.aiHandoffAgentId;

    const [updated] = await req.scoped!((tx) =>
      tx
        .update(campaigns)
        .set(patch)
        .where(and(eq(campaigns.id, id), eq(campaigns.status, 'draft')))
        .returning(),
    );
    if (!updated) {
      res.status(409).json({ error: 'not_editable', message: 'So campanhas em rascunho podem ser editadas.' });
      return;
    }
    res.json({ campaign: updated });
  });

  router.delete('/api/campaigns/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(campaigns)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning({ id: campaigns.id }),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  router.put('/api/campaigns/:id/steps', ...editGuard, async (req: Request, res: Response) => {
    const parsed = stepsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id));
      if (!campaign) return null;
      await tx.delete(campaignSteps).where(eq(campaignSteps.campaignId, id));
      const rows = await tx
        .insert(campaignSteps)
        .values(
          parsed.data.steps.map((s) => ({
            campaignId: id,
            position: s.position,
            templateName: s.templateName,
            languageCode: s.languageCode ?? 'pt_BR',
            templateComponents: s.templateComponents ?? [],
            delaySeconds: s.delaySeconds ?? 0,
            stopOnReply: s.stopOnReply ?? true,
          })),
        )
        .returning();
      return rows;
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ steps: result });
  });

  router.put('/api/campaigns/:id/followups', ...editGuard, async (req: Request, res: Response) => {
    const parsed = followupsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id));
      if (!campaign) return null;
      await tx.delete(campaignFollowups).where(eq(campaignFollowups.campaignId, id));
      if (parsed.data.followups.length === 0) return [];
      const rows = await tx
        .insert(campaignFollowups)
        .values(
          parsed.data.followups.map((f, i) => ({
            campaignId: id,
            triggerEvent: f.triggerEvent,
            delayMinutes: f.delayMinutes ?? 60,
            templateName: f.templateName,
            languageCode: f.languageCode ?? 'pt_BR',
            templateComponents: f.templateComponents ?? [],
            position: f.position ?? i,
            isActive: f.isActive ?? true,
          })),
        )
        .returning();
      return rows;
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ followups: result });
  });

  router.post('/api/campaigns/:id/validate', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const outcome = await req.scoped!(async (tx) => {
      const snap = await loadCampaignChannel(tx, id);
      if (!snap) return null;
      const vc = await buildValidationCampaign(tx, snap);
      const ports = makeGraphPorts(snap);
      return validateCampaign(vc, ports);
    });
    if (!outcome) {
      res.sendStatus(404);
      return;
    }
    res.json(outcome);
  });

  return router;
}
