/**
 * Verificação de assinatura HMAC do webhook Meta (F1-S02).
 *
 * A implementação canônica vive em `@hm/channels` (`packages/channels/src/shared/hmac.ts`),
 * conforme LIVECHAT.md §2.4. Reexportada aqui para que as rotas de webhook tenham um
 * ponto de import local estável e sem duplicar a lógica de crypto.
 */
export { verifyMetaSignature } from '@hm/channels';
