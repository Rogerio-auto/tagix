/**
 * Porta única do gateway de pagamento (PAYMENTS_ABACATEPAY.md §3/§5).
 *
 * `getPaymentProvider()` é a fábrica que o resto da API consome — o checkout
 * self-serve (F41-S04) e o fluxo assistido de plataforma (F41-S07) reusam a
 * MESMA instância de provider, garantindo que ambos falem com o gateway pelo
 * mesmo adapter tipado.
 *
 * Seleção por env: se `ABACATEPAY_API_KEY` está setada (segredo de plataforma,
 * nunca por-tenant, nunca logado), usa o `AbacatePayProvider` real; caso
 * contrário cai no `MockPaymentProvider` determinístico (dev/testes sem rede).
 *
 * A instância é memoizada (singleton de processo) — o client HTTP é stateless e
 * reaproveitável, e evitamos recriar a configuração a cada request.
 */
import {
  AbacatePayProvider,
  MockPaymentProvider,
  type IPaymentProvider,
} from '@hm/payments';

let cached: IPaymentProvider | null = null;

/**
 * Retorna o provider de pagamento do processo (memoizado).
 *
 * - `ABACATEPAY_API_KEY` presente → `AbacatePayProvider` (cobrança real).
 * - Ausente → `MockPaymentProvider` (dev/testes; sem rede).
 *
 * A API key NUNCA é logada nem exposta — fica apenas no escopo do adapter.
 */
export function getPaymentProvider(): IPaymentProvider {
  if (cached) return cached;

  const apiKey = process.env['ABACATEPAY_API_KEY'];
  cached =
    apiKey !== undefined && apiKey !== ''
      ? new AbacatePayProvider({ apiKey })
      : new MockPaymentProvider();

  return cached;
}

/**
 * Reseta o singleton — uso exclusivo de testes que precisam alternar a env
 * entre `AbacatePayProvider` e `MockPaymentProvider`. Em produção é no-op
 * intencionalmente não chamado.
 */
export function __resetPaymentProviderForTests(): void {
  cached = null;
}
