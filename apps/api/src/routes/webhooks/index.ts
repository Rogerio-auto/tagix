/**
 * Rotas de webhook inbound (F1-S02).
 *
 * ┌─ INTEGRAÇÃO (orquestrador) ────────────────────────────────────────────────┐
 * │ Monte este router ANTES do `express.json()` global em `app.ts`:             │
 * │                                                                             │
 * │     app.use(createWebhooksRouter());   // raw body, antes do json           │
 * │     app.use(express.json({ limit: '1mb' }));                                │
 * │                                                                             │
 * │ As rotas POST aplicam `express.raw()` no nível da rota porque o HMAC Meta   │
 * │ exige os bytes EXATOS recebidos. Se o `express.json()` global rodar antes,  │
 * │ ele consome o stream e o corpo bruto se perde → a verificação de assinatura │
 * │ falha (403). Por isso a ORDEM importa.                                      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { Router } from 'express';
import { createMetaWebhookRouter } from './meta';
import { createWahaWebhookRouter } from './waha';

/** Router agregado: `/webhooks/meta` (WA + IG) e `/webhooks/waha`. */
export function createWebhooksRouter(): Router {
  const router = Router();
  router.use(createMetaWebhookRouter());
  router.use(createWahaWebhookRouter());
  return router;
}

export { createMetaWebhookRouter } from './meta';
export { createWahaWebhookRouter } from './waha';
export { closeWebhookPublisher } from './publisher';
