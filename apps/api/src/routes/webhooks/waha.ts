/**
 * Webhook WAHA (F1-S02, LIVECHAT.md §2.3/§2.4).
 *
 * WAHA é provider não-Meta → endpoint próprio. A autenticação é por API key
 * compartilhada (header `x-api-key`), comparada em constant-time. Mesma borda:
 * verify → dedup → publish `inbound.message` com provider `waha`.
 *
 * Lê o RAW body (Buffer) por consistência com /webhooks/meta e para um id de
 * dedup estável a partir dos bytes recebidos.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import { createLogger } from '@hm/logger';
import { platformSecrets } from '../../secrets';
import { hasWebhookEvent, recordWebhookRedelivery, registerWebhookEvent } from './dedup';
import { deriveEventId } from './event-id';
import { publishInboundMessage } from './publisher';

const API_KEY_HEADER = 'x-api-key';

const wahaLogger = createLogger('info', { svc: 'waha-webhook' });

/** Comparação constant-time de strings (evita timing oracle no segredo). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getRawBody(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

export function createWahaWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/webhooks/waha',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req: Request, res: Response) => {
      const expectedKey = platformSecrets.get('waha_webhook_secret');
      const providedKey = req.get(API_KEY_HEADER);

      // Segredo ausente OU key inválida → 403.
      if (!expectedKey || !providedKey || !safeEqual(providedKey, expectedKey)) {
        res.sendStatus(403);
        return;
      }

      const rawBody = getRawBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.sendStatus(200);
        return;
      }

      const body =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null;
      if (!body) {
        res.sendStatus(200);
        return;
      }

      const eventId = deriveEventId(rawBody, parsed);

      // Reentrega: evento já processado → ack 200 sem republicar (e contabiliza).
      if (await hasWebhookEvent({ provider: 'waha', externalEventId: eventId, rawPayload: body })) {
        recordWebhookRedelivery('waha');
        wahaLogger.info('webhook.waha.redelivery', { eventId });
        res.sendStatus(200);
        return;
      }

      // Enqueue ANTES de marcar o dedup (F52-S02). Publish que lança OU retorna
      // false (backpressure) é falha: não marca dedup e responde 5xx para o WAHA
      // reentregar — sem janela de perda de evento.
      try {
        const published = await publishInboundMessage({ provider: 'waha', raw: body });
        if (!published) {
          wahaLogger.warn('webhook.waha.enqueue.backpressure', { eventId });
          res.sendStatus(503);
          return;
        }
      } catch (err) {
        wahaLogger.error('webhook.waha.enqueue.failed', {
          eventId,
          error: err instanceof Error ? err.message : 'unknown',
        });
        res.sendStatus(503);
        return;
      }

      // Enqueue confirmado → marca o dedup (idempotência da borda).
      await registerWebhookEvent({ provider: 'waha', externalEventId: eventId, rawPayload: body });

      res.sendStatus(200);
    },
  );

  return router;
}
