/**
 * F72-S07 — cobrança no DS 3.0. Em empresa só leitura a cobrança CONTINUA habilitada:
 * é o caminho para voltar a editar (a API isenta `/api/billing/**`). Preço em mono.
 * Ambiente `node`.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import type { BillingPlan } from './queries';

Reflect.set(globalThis, 'React', React);

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => true,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('./queries', () => ({
  useStartCheckout: () => ({ isPending: false, mutateAsync: async () => ({ redirectUrl: '' }) }),
}));

const { PlanSelector } = await import('./components/PlanSelector');

const PLANS: BillingPlan[] = [
  { id: 'p1', key: 'pro', name: 'Pro', priceMonthlyCents: 19_900, priceYearlyCents: 199_000 },
];

describe('PlanSelector em empresa só leitura (F72-S07)', () => {
  it('o checkout segue habilitado, sem aria-disabled nem explicação de bloqueio', () => {
    const html = renderToStaticMarkup(
      <PlanSelector plans={PLANS} currentPlanId={null} currentCycle={null} />,
    );
    expect(html).toContain('Continuar para pagamento');
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('Modo só leitura');
  });

  it('preço do plano em mono tabular', () => {
    const html = renderToStaticMarkup(
      <PlanSelector plans={PLANS} currentPlanId={null} currentCycle={null} />,
    );
    expect(html).toMatch(/font-mono[^"]*tabular-nums[^"]*">[^<]*199/);
  });
});
