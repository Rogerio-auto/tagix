/**
 * Verificação de assinatura HMAC do webhook Meta (F1-S02).
 *
 * ┌─ NOTA DE INTEGRAÇÃO (orquestrador) ─────────────────────────────────────────┐
 * │ A implementação canônica vive em `packages/channels/src/shared/hmac.ts`     │
 * │ (`verifyMetaSignature`), conforme LIVECHAT.md §2.4. Idealmente esta rota a   │
 * │ importaria de `@hm/channels`. Porém `@hm/channels` NÃO está em              │
 * │ `apps/api/package.json` e este slot não pode editar package.json nem rodar  │
 * │ `pnpm install`. Para manter o pacote compilando e auto-contido, a lógica é  │
 * │ replicada aqui (idêntica byte-a-byte ao shared). AÇÃO recomendada: adicionar│
 * │ `"@hm/channels": "workspace:*"` em apps/api/package.json e trocar este       │
 * │ módulo por `export { verifyMetaSignature } from '@hm/channels';`.           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica a assinatura `x-hub-signature-256` de um webhook Meta.
 *
 * @param rawBody Bytes EXATOS recebidos (Buffer/string) — nunca o JSON re-serializado.
 * @param signatureHeader Valor de `x-hub-signature-256` (com prefixo `sha256=`).
 * @param appSecret App secret do Meta App.
 * @returns `true` se confere (comparação constant-time).
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  if (provided.length === 0) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', appSecret).update(body).digest('hex');

  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}
