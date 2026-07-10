/**
 * @hm/shared/net — utilitários de rede com segurança embutida (F56-S07).
 *
 * Hoje: guarda anti-SSRF para destinos outbound controlados por tenant (webhooks).
 * Node-only em runtime (imports dinâmicos), browser-safe para bundling.
 */
export {
  SsrfBlockedError,
  isBlockedIpAddress,
  checkWebhookUrlSyntax,
  assertSafeWebhookUrl,
  createGuardedLookup,
  ssrfSafeFetch,
  httpAllowlistFromEnv,
} from './ssrf-guard';
export type {
  SsrfBlockedReason,
  WebhookUrlCheck,
  WebhookUrlOptions,
  DnsLookupAll,
  SsrfSafeFetchOptions,
} from './ssrf-guard';
