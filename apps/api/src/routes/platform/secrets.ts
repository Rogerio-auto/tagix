/**
 * API de plataforma — gestão/rotação de `platform_secrets` (F25-S04).
 *
 *   GET /api/platform/secrets         lista metadados (key, key_version, updated_at) — SEM valor
 *   PUT /api/platform/secrets/:key    { value } → cifra, upsert, key_version++ + audit
 *
 * Sensível: o valor em claro NUNCA aparece em resposta nem em log. Gated por
 * `requirePlatformAdmin`. Key desconhecida → 400. Wire em app.ts é do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import {
  isKnownSecretKey,
  listSecretMeta,
  rotateSecret,
} from '../../services/platform/secret-rotation';

const { auditLogs } = schema;

const putSchema = z.object({ value: z.string().min(1).max(8000) });

export function createPlatformSecretsRouter(): Router {
  const router = Router();
  const db = getDb();

  router.get('/api/platform/secrets', ...requirePlatformAdmin, async (_req, res: Response) => {
    res.json({ secrets: await listSecretMeta(db) });
  });

  router.put(
    '/api/platform/secrets/:key',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const key = String(req.params['key'] ?? '');
      if (!isKnownSecretKey(key)) {
        res.status(400).json({ error: 'unknown_secret_key' });
        return;
      }
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        // NÃO ecoa o body (poderia conter o valor) nas issues sensíveis.
        res.status(400).json({ error: 'invalid_body' });
        return;
      }

      const meta = await rotateSecret(key, parsed.data.value, db);

      // Auditoria obrigatória — registra a rotação, JAMAIS o valor.
      await db.insert(auditLogs).values({
        workspaceId: req.auth!.member.workspaceId,
        actorMemberId: req.auth!.member.id,
        actorType: 'platform_admin',
        action: 'platform.secret_rotated',
        resourceType: 'platform_secret',
        metadata: { key, toVersion: meta.keyVersion },
      });

      res.json({ secret: meta });
    },
  );

  return router;
}
