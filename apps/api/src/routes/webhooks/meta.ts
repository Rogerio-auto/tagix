/**
 * Webhook Meta unificado (F1-S02, LIVECHAT.md §2.4).
 *
 * Um único endpoint para WhatsApp Cloud + Instagram, porque ambos vivem no mesmo
 * Meta App (Highermind como Tech Provider único → mesmo `app_secret`).
 *
 *   GET  /webhooks/meta  → verify handshake (hub.challenge)
 *   POST /webhooks/meta  → verify HMAC → dedup → publish `inbound.message`
 *
 * O corpo POST é lido como RAW (Buffer) — o HMAC precisa dos bytes EXATOS
 * recebidos; um JSON re-serializado divergiria da assinatura da Meta.
 */
import { Buffer } from 'node:buffer';
import express, { Router, type Request, type Response } from 'express';
import type { ChannelProvider } from '@hm/shared';
import { platformSecrets } from '../../secrets';
import { registerWebhookEvent } from './dedup';
import { deriveEventId } from './event-id';
import { publishInboundMessage } from './publisher';
import { verifyMetaSignature } from './signature';
import { summarizeInstagramEnvelope } from './meta-instagram';
import {
  createSubmissionDeps,
  processMetaFlowSubmission,
  type MetaFlowSubmissionInput,
} from '../flows/submissions';
import { createLogger } from '@hm/logger';

const SIGNATURE_HEADER = 'x-hub-signature-256';

/** Mapeia `body.object` da Meta → provider de canal. */
function providerForObject(object: unknown): ChannelProvider | null {
  if (object === 'whatsapp_business_account') return 'meta_whatsapp';
  if (object === 'instagram') return 'meta_instagram';
  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getRawBody(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

/**
 * Extrai submissions de WhatsApp Flow (`interactive.nfm_reply`) de um payload Meta WA.
 * Cada nfm_reply vira um MetaFlowSubmissionInput (F4-S14). Tolerante a shape: ignora
 * entries sem flow response. O `response_json` do nfm_reply e a resposta estruturada.
 */
function extractFlowSubmissions(body: Record<string, unknown>): MetaFlowSubmissionInput[] {
  const out: MetaFlowSubmissionInput[] = [];
  const entries = Array.isArray(body['entry']) ? (body['entry'] as unknown[]) : [];
  for (const entry of entries) {
    const changes = isRecord(entry) && Array.isArray(entry['changes']) ? entry['changes'] : [];
    for (const change of changes as unknown[]) {
      const value = isRecord(change) ? change['value'] : undefined;
      if (!isRecord(value)) continue;
      const metadata = isRecord(value['metadata']) ? value['metadata'] : undefined;
      const phoneNumberId = asString(metadata?.['phone_number_id']);
      if (!phoneNumberId) continue;
      const messages = Array.isArray(value['messages']) ? value['messages'] : [];
      for (const msg of messages as unknown[]) {
        if (!isRecord(msg)) continue;
        const interactive = isRecord(msg['interactive']) ? msg['interactive'] : undefined;
        const nfm =
          interactive && isRecord(interactive['nfm_reply']) ? interactive['nfm_reply'] : undefined;
        if (!nfm) continue;
        const responseJson = parseResponseJson(nfm['response_json']);
        out.push({
          phoneNumberId,
          metaFlowId: asString(nfm['name']) ?? asString(responseJson['flow_id']) ?? 'unknown',
          externalId: asString(msg['id']),
          contactRemoteId: asString(msg['from']),
          response: responseJson,
        });
      }
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseResponseJson(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const webhookLogger = createLogger('info', { svc: 'meta-webhook' });
const submissionDeps = createSubmissionDeps(webhookLogger);

export function createMetaWebhookRouter(): Router {
  const router = Router();

  // GET verify handshake — a Meta chama uma vez ao assinar o webhook.
  router.get('/webhooks/meta', (req: Request, res: Response) => {
    const mode = asString(req.query['hub.mode']);
    const token = asString(req.query['hub.verify_token']);
    const challenge = asString(req.query['hub.challenge']);
    const expected = platformSecrets.get('meta_webhook_verify_token');

    if (mode === 'subscribe' && expected !== undefined && token === expected && challenge) {
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  // POST recebe o RAW body para o HMAC. `type: () => true` força raw em qualquer
  // content-type (a Meta envia application/json).
  router.post(
    '/webhooks/meta',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req: Request, res: Response) => {
      const rawBody = getRawBody(req);
      const appSecret = platformSecrets.get('meta_app_secret');
      const signature = req.get(SIGNATURE_HEADER);

      // app_secret ausente OU assinatura inválida → 403 (0% em prod).
      if (!appSecret || !verifyMetaSignature(rawBody, signature, appSecret)) {
        res.sendStatus(403);
        return;
      }

      // Parse seguro do corpo já autenticado.
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        // Corpo não-JSON com assinatura válida é anômalo, mas respondemos 200
        // para a Meta não reentregar; nada a publicar.
        res.sendStatus(200);
        return;
      }

      const body =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      const provider = providerForObject(body?.['object']);

      // Objeto desconhecido (ex.: 'page' legado): ack sem publicar.
      if (!body || !provider) {
        res.sendStatus(200);
        return;
      }

      // Dedup na borda: evento repetido não re-publica (DoD).
      const eventId = deriveEventId(rawBody, parsed);
      const isFirst = await registerWebhookEvent({
        provider,
        externalEventId: eventId,
        rawPayload: body,
      });

      if (isFirst) {
        await publishInboundMessage({ provider, raw: body });
        // F4-S14: despacha submissions de WhatsApp Flow (nfm_reply) -> engine.
        if (provider === 'meta_whatsapp') {
          for (const submission of extractFlowSubmissions(body)) {
            try {
              await processMetaFlowSubmission(submission, submissionDeps);
            } catch {
              // Nao bloqueia o ack do webhook; o erro ja e logado no handler.
            }
          }
        }
        // F15-S02: observabilidade da ingestao IG (sem parse de dominio aqui).
        if (provider === 'meta_instagram') {
          const summary = summarizeInstagramEnvelope(body);
          webhookLogger.info('webhook.instagram.ingested', {
            igUserIds: summary.igUserIds,
            counts: summary.counts,
            total: summary.total,
          });
        }
      }

      // Meta exige resposta < 5s — devolvemos 200 imediatamente.
      res.sendStatus(200);
    },
  );

  return router;
}
