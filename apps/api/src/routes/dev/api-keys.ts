/**
 * Gestão de API keys (F9-S04) — consumido pela página Settings → Dev (session-authed,
 * NÃO api-key). Reusa os helpers de token da F9-S02 (`generateApiKey`/`hashToken`):
 * nada de regra de token duplicada.
 *
 * Show-once: o token claro `hm_...` só existe na resposta da CRIAÇÃO. A listagem
 * nunca expõe `key_hash` — só `key_prefix` (display) + metadados. Revogar marca
 * `revoked_at`/`is_active=false` (lookup da F9-S02 passa a falhar imediatamente).
 *
 * Scopes válidos espelham `API_SCOPES` da v1; a criação valida contra essa lista.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { generateApiKey } from '../../services/api-keys';
import { API_SCOPES } from '../v1/schemas';

const { apiKeys } = schema;

/** Scopes oferecidos na criação — fonte única é `API_SCOPES` da API v1. */
const VALID_SCOPES = Object.values(API_SCOPES) as [string, ...string[]];

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(VALID_SCOPES)).min(1),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(10_000).default(60),
  expiresAt: z.coerce.date().optional(),
});

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

/** Projeção pública de uma api_key — NUNCA inclui `key_hash`. */
const publicColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  rateLimitPerMinute: apiKeys.rateLimitPerMinute,
  isActive: apiKeys.isActive,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  createdAt: apiKeys.createdAt,
  revokedAt: apiKeys.revokedAt,
};

export function createDevApiKeysRouter(): Router {
  const router = Router();
  const listGuard = [requireAuth, withRLS, requireRole('apikey.list')] as const;
  const createGuard = [requireAuth, withRLS, requireRole('apikey.create')] as const;
  const revokeGuard = [requireAuth, withRLS, requireRole('apikey.revoke')] as const;

  // ─── GET /api/dev/api-keys — lista (sem hash, sem token) ─────────────────────
  router.get('/api/dev/api-keys', ...listGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx.select(publicColumns).from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    );
    res.json({ apiKeys: rows });
  });

  // ─── POST /api/dev/api-keys — cria; retorna o token CLARO uma única vez ──────
  router.post('/api/dev/api-keys', ...createGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const { name, scopes, rateLimitPerMinute, expiresAt } = parsed.data;
    const gen = generateApiKey();
    const workspaceId = req.auth!.workspace.id;
    const createdBy = req.auth!.member.id;

    const [created] = await req.scoped!((tx) =>
      tx
        .insert(apiKeys)
        .values({
          workspaceId,
          name,
          keyHash: gen.keyHash,
          keyPrefix: gen.keyPrefix,
          scopes,
          rateLimitPerMinute,
          expiresAt: expiresAt ?? null,
          createdBy,
        })
        .returning(publicColumns),
    );
    if (!created) {
      res.status(500).json({ error: 'create_failed', message: 'Falha ao criar a API key.' });
      return;
    }
    // `token` só existe AQUI — não persiste e nunca mais é exibível.
    res.status(201).json({ apiKey: created, token: gen.token });
  });

  // ─── POST /api/dev/api-keys/:id/revoke — invalida imediatamente ──────────────
  router.post('/api/dev/api-keys/:id/revoke', ...revokeGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id) {
      res.status(400).json({ error: 'invalid_request', message: 'id ausente.' });
      return;
    }
    const [revoked] = await req.scoped!((tx) =>
      tx
        .update(apiKeys)
        .set({ isActive: false, revokedAt: new Date() })
        // Idempotente: só revoga chave ainda ativa (não-revogada).
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning(publicColumns),
    );
    if (!revoked) {
      res.status(404).json({ error: 'not_found', message: 'API key não encontrada ou já revogada.' });
      return;
    }
    res.json({ apiKey: revoked });
  });

  return router;
}
