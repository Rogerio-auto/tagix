/**
 * Anexos de deal com EXIF/GPS (PIPELINE.md 5.2, DATA_MODEL 10.5).
 *
 * Endpoints sob /api/deals/:id/attachments, RLS via req.scoped:
 *   POST   /api/deals/:id/attachments/signed-url  -> { url, key } p/ upload R2  (deal.edit)
 *   GET    /api/deals/:id/attachments             lista anexos                  (deal.edit)
 *   POST   /api/deals/:id/attachments             persiste metadata (EXIF/GPS)  (deal.edit)
 *   DELETE /api/deals/:id/attachments/:attId      remove (storage + row)        (deal.edit)
 *
 * O storage e injetado via porta `AttachmentStorage` (default = @hm/storage no
 * aggregator) — mantem o router testavel sem driver real.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { deals, dealAttachments } = schema;

/** Porta minima de storage (subset de IStorageDriver) usada pelos anexos. */
export interface AttachmentStorage {
  getSignedUrl(key: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  delete(key: string): Promise<void>;
}

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const signedUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(128),
});

const persistSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  mime: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().trim().length(64),
  filename: z.string().trim().max(255).nullish(),
  caption: z.string().trim().max(500).nullish(),
  gpsLat: z.number().min(-90).max(90).nullish(),
  gpsLon: z.number().min(-180).max(180).nullish(),
  gpsAltitude: z.number().nullish(),
  gpsAccuracy: z.number().min(0).nullish(),
  capturedAt: z.string().datetime().nullish(),
  indexNumber: z.number().int().nullish(),
  metadata: z
    .object({
      city: z.string().optional(),
      state: z.string().optional(),
      address: z.string().optional(),
      country: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

async function dealExists(req: Request, dealId: string): Promise<boolean> {
  const [row] = await req.scoped!((tx) =>
    tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1),
  );
  return Boolean(row);
}

export function createDealAttachmentsRouter(storage: AttachmentStorage): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('deal.edit')] as const;

  // POST /api/deals/:id/attachments/signed-url — gera URL de upload + key.
  router.post(
    '/api/deals/:id/attachments/signed-url',
    ...editGuard,
    async (req: Request, res: Response) => {
      const parsed = signedUrlSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const dealId = param(req, 'id');
      if (!(await dealExists(req, dealId))) {
        res.sendStatus(404);
        return;
      }
      const workspaceId = req.auth!.workspace.id;
      const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `workspaces/${workspaceId}/deals/${dealId}/${randomUUID()}-${safeName}`;
      const signed = await storage.getSignedUrl(key, 600);
      res.json({ url: signed.url, key, expiresAt: signed.expiresAt });
    },
  );

  // GET /api/deals/:id/attachments — lista.
  router.get('/api/deals/:id/attachments', ...editGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(dealAttachments)
        .where(eq(dealAttachments.dealId, param(req, 'id')))
        .orderBy(desc(dealAttachments.createdAt)),
    );
    res.json({ attachments: rows });
  });

  // POST /api/deals/:id/attachments — persiste metadata.
  router.post('/api/deals/:id/attachments', ...editGuard, async (req: Request, res: Response) => {
    const parsed = persistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const dealId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    const result = await req.scoped!(async (tx) => {
      const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
      if (!deal) return null;
      const [created] = await tx
        .insert(dealAttachments)
        .values({
          workspaceId,
          dealId,
          storageKey: d.storageKey,
          mime: d.mime,
          sizeBytes: d.sizeBytes,
          sha256: d.sha256,
          filename: d.filename ?? null,
          caption: d.caption ?? null,
          gpsLat: d.gpsLat == null ? null : String(d.gpsLat),
          gpsLon: d.gpsLon == null ? null : String(d.gpsLon),
          gpsAltitude: d.gpsAltitude == null ? null : String(d.gpsAltitude),
          gpsAccuracy: d.gpsAccuracy == null ? null : String(d.gpsAccuracy),
          capturedAt: d.capturedAt ? new Date(d.capturedAt) : null,
          uploadedBy: req.auth!.member.id,
          indexNumber: d.indexNumber ?? null,
          metadata: d.metadata ?? {},
        })
        .returning();
      if (created) {
        await tx.insert(schema.dealHistory).values({
          dealId,
          workspaceId,
          eventType: 'attachment_added',
          actorMemberId: req.auth!.member.id,
          actorType: 'member',
        });
      }
      return created;
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.status(201).json({ attachment: result });
  });

  // DELETE /api/deals/:id/attachments/:attId — remove storage + row.
  router.delete(
    '/api/deals/:id/attachments/:attId',
    ...editGuard,
    async (req: Request, res: Response) => {
      const dealId = param(req, 'id');
      const attId = param(req, 'attId');
      const removed = await req.scoped!(async (tx) => {
        const [row] = await tx
          .delete(dealAttachments)
          .where(and(eq(dealAttachments.id, attId), eq(dealAttachments.dealId, dealId)))
          .returning({ storageKey: dealAttachments.storageKey });
        return row ?? null;
      });
      if (!removed) {
        res.sendStatus(404);
        return;
      }
      // Best-effort: remove o objeto do storage apos apagar a row.
      try {
        await storage.delete(removed.storageKey);
      } catch {
        // objeto orfao no storage e tolerado (limpeza por GC futura).
      }
      res.sendStatus(204);
    },
  );

  return router;
}
