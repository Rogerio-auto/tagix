/**
 * Gestão de webhooks outbound (F9-S04) — Settings → Dev (session-authed).
 *
 * CRUD de `outbound_webhooks` (assinaturas do cliente) + teste de entrega + log de
 * entregas (`outbound_webhook_deliveries`). O segredo HMAC é cifrado em AES-256-GCM
 * (`encryptSecret`, F1-S01) ao persistir e NUNCA é retornado em leitura — só um flag
 * `hasSecret`. O cliente recebe o segredo claro UMA vez, na criação (show-once), para
 * configurar a verificação da assinatura no endpoint dele.
 *
 * O dispatch real recorrente é do worker-webhooks (F9-S05); aqui o "test" faz UM POST
 * síncrono assinado para validar a URL/segredo na hora.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret, schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { outboundWebhooks, outboundWebhookDeliveries } = schema;

/**
 * Catálogo de eventos assináveis. Fonte canônica dos eventos de domínio que o
 * worker-webhooks (F9-S05) faz fan-out. Mantido aqui (borda de validação); S05
 * consome os mesmos nomes.
 */
export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'conversation.opened',
  'conversation.resolved',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'conversion.registered',
] as const;

const eventEnum = z.enum(WEBHOOK_EVENTS);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(2000),
  events: z.array(eventEnum).min(1),
  // Opcional: o cliente pode trazer o próprio segredo; senão geramos um forte.
  secret: z.string().trim().min(16).max(200).optional(),
  isActive: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().url().max(2000).optional(),
  events: z.array(eventEnum).min(1).optional(),
  secret: z.string().trim().min(16).max(200).optional(),
  isActive: z.boolean().optional(),
});

function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

/** Projeção pública — nunca expõe `secret_enc`; só sinaliza presença. */
const publicColumns = {
  id: outboundWebhooks.id,
  name: outboundWebhooks.name,
  url: outboundWebhooks.url,
  events: outboundWebhooks.events,
  isActive: outboundWebhooks.isActive,
  createdAt: outboundWebhooks.createdAt,
  updatedAt: outboundWebhooks.updatedAt,
};

/** Assina `payload` com HMAC-SHA256 (mesmo esquema do dispatch da F9-S05). */
function signPayload(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;
}

export function createDevWebhooksRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('webhook.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('webhook.edit')] as const;

  // ─── GET /api/dev/webhooks — lista assinaturas (sem segredo) ─────────────────
  router.get('/api/dev/webhooks', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx.select(publicColumns).from(outboundWebhooks).orderBy(desc(outboundWebhooks.createdAt)),
    );
    res.json({ webhooks: rows, availableEvents: WEBHOOK_EVENTS });
  });

  // ─── POST /api/dev/webhooks — cria; retorna o segredo claro uma única vez ────
  router.post('/api/dev/webhooks', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const { name, url, events, isActive } = parsed.data;
    const secret = parsed.data.secret ?? randomBytes(24).toString('base64url');
    const workspaceId = req.auth!.workspace.id;

    const [created] = await req.scoped!((tx) =>
      tx
        .insert(outboundWebhooks)
        .values({ workspaceId, name, url, events, isActive, secretEnc: encryptSecret(secret) })
        .returning(publicColumns),
    );
    if (!created) {
      res.status(500).json({ error: 'create_failed', message: 'Falha ao criar o webhook.' });
      return;
    }
    // `secret` só existe aqui — show-once para o cliente configurar a verificação.
    res.status(201).json({ webhook: created, secret });
  });

  // ─── PATCH /api/dev/webhooks/:id — edita (re-cifra segredo se vier) ──────────
  router.patch('/api/dev/webhooks/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id) {
      res.status(400).json({ error: 'invalid_request', message: 'id ausente.' });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch['name'] = body.name;
    if (body.url !== undefined) patch['url'] = body.url;
    if (body.events !== undefined) patch['events'] = body.events;
    if (body.isActive !== undefined) patch['isActive'] = body.isActive;
    let rotatedSecret: string | undefined;
    if (body.secret !== undefined) {
      rotatedSecret = body.secret;
      patch['secretEnc'] = encryptSecret(body.secret);
    }

    const [updated] = await req.scoped!((tx) =>
      tx.update(outboundWebhooks).set(patch).where(eq(outboundWebhooks.id, id)).returning(publicColumns),
    );
    if (!updated) {
      res.status(404).json({ error: 'not_found', message: 'Webhook não encontrado.' });
      return;
    }
    res.json({ webhook: updated, ...(rotatedSecret ? { secret: rotatedSecret } : {}) });
  });

  // ─── DELETE /api/dev/webhooks/:id — remove (cascade nas deliveries) ─────────
  router.delete('/api/dev/webhooks/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id) {
      res.status(400).json({ error: 'invalid_request', message: 'id ausente.' });
      return;
    }
    const [deleted] = await req.scoped!((tx) =>
      tx.delete(outboundWebhooks).where(eq(outboundWebhooks.id, id)).returning({ id: outboundWebhooks.id }),
    );
    if (!deleted) {
      res.status(404).json({ error: 'not_found', message: 'Webhook não encontrado.' });
      return;
    }
    res.status(204).end();
  });

  // ─── POST /api/dev/webhooks/:id/test — entrega de teste síncrona assinada ────
  router.post('/api/dev/webhooks/:id/test', ...editGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id) {
      res.status(400).json({ error: 'invalid_request', message: 'id ausente.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;

    const webhook = await req.scoped!(async (tx) => {
      const [row] = await tx
        .select({ url: outboundWebhooks.url, secretEnc: outboundWebhooks.secretEnc })
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, id))
        .limit(1);
      return row ?? null;
    });
    if (!webhook) {
      res.status(404).json({ error: 'not_found', message: 'Webhook não encontrado.' });
      return;
    }

    const payloadObj = {
      event: 'webhook.test',
      workspaceId,
      data: { message: 'Entrega de teste do Highermind.' },
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(payloadObj);
    const signature = signPayload(decryptSecret(webhook.secretEnc), payload);

    // POST síncrono com timeout curto — só validar URL/conectividade. Erro de rede
    // não é 5xx do nosso lado: reportamos o outcome (delivered:false + motivo).
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hm-signature-256': signature },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      res.json({ delivered: resp.ok, status: resp.status });
    } catch (err) {
      res.json({ delivered: false, error: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // ─── GET /api/dev/webhooks/:id/deliveries — log de entregas ──────────────────
  router.get('/api/dev/webhooks/:id/deliveries', ...viewGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id) {
      res.status(400).json({ error: 'invalid_request', message: 'id ausente.' });
      return;
    }
    const rows = await req.scoped!((tx) =>
      tx
        .select({
          id: outboundWebhookDeliveries.id,
          event: outboundWebhookDeliveries.event,
          status: outboundWebhookDeliveries.status,
          responseStatus: outboundWebhookDeliveries.responseStatus,
          attempt: outboundWebhookDeliveries.attempt,
          nextAttemptAt: outboundWebhookDeliveries.nextAttemptAt,
          createdAt: outboundWebhookDeliveries.createdAt,
          sentAt: outboundWebhookDeliveries.sentAt,
        })
        .from(outboundWebhookDeliveries)
        .where(eq(outboundWebhookDeliveries.webhookId, id))
        .orderBy(desc(outboundWebhookDeliveries.createdAt))
        .limit(100),
    );
    res.json({ deliveries: rows });
  });

  return router;
}

// Exposto p/ testes do slot (assinatura idêntica ao dispatch da F9-S05).
export const __test = { signPayload };
