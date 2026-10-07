/**
 * F70-S32 — painel fechado fora do foco e da árvore de acessibilidade.
 *
 * O painel de ajuda (`shared/components/help/Sheet.tsx`) fica montado depois de fechar,
 * só para a transição de saída. Sem `inert` + `aria-hidden`, o leitor de tela o anunciava
 * fora da tela e o Tab entrava nos botões dele. O drawer "Novo produto" tem a mesma prova
 * em `cockpit-enrichment.spec.ts`; o `HelpHint` do `@hm/ui`, no teste unitário dele.
 *
 * NOTA(host): a app não hidrata no headless-shell deste host Windows; spec escrita para o CI.
 */
import { test, expect } from '../fixtures/test';

test.describe('F70-S32 — painel de ajuda fechado sai da acessibilidade', () => {
  test('/agents: o painel "Agentes" só existe para o leitor de tela enquanto aberto', async ({
    page,
  }) => {
    await page.goto('/agents');
    const panel = page.getByRole('complementary', { name: 'Agentes' });

    // Fechado (estado inicial): montado no portal, mas invisível para a acessibilidade.
    await expect(panel).toHaveCount(0);

    await page.getByRole('button', { name: 'Ajuda: Agentes' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'Fechar' }).click();
    await expect(panel).toHaveCount(0);
  });
});
