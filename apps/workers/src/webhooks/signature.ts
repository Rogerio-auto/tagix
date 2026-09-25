/**
 * Assinatura dos webhooks de saída (F70-S19). Desde a F70-S20 o signer e o
 * verificador de referência moram em `@hm/shared` (`packages/shared/src/webhook-signature.ts`,
 * exportados por `@hm/shared/mq`), para a API (entrega de teste) e os workers
 * (dispatcher) usarem a MESMA função. Este módulo só reexporta, para quem importa o
 * caminho antigo (`./index` do pacote de webhooks e a documentação pública).
 */
export {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
  signatureHeaders,
  signWebhook,
  unixSeconds,
  verifyWebhookSignature,
  type VerifyWebhookInput,
  type VerifyWebhookResult,
} from '@hm/shared/mq';
