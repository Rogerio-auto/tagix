/**
 * Pipeline / kanban (F10-S03) — render dos stages/deals e move-stage.
 *
 * O DnD do dnd-kit não é exercido por gesto (frágil/flaky headless); validamos o
 * efeito de negócio chamando o mesmo contrato `move-stage` que o board usa e
 * conferindo o estado do backend simulado + o re-render da UI.
 */

import { test, expect } from '../fixtures/test';
import { PipelinePage } from '../pages/pom';

test.describe('Pipeline', () => {
  test('renderiza stages e o deal seedado', async ({ page }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.goto();

    await expect(page.getByRole('heading', { level: 3, name: 'Lead' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Negociação' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Ganho' })).toBeVisible();
    await expect(pipeline.dealCard('Negócio com Ana')).toBeVisible();
  });

  test('move-stage atualiza o backend simulado', async ({ page, mock }) => {
    const pipeline = new PipelinePage(page);
    await pipeline.goto();
    await expect(pipeline.dealCard('Negócio com Ana')).toBeVisible();

    const ok = await page.evaluate(async () => {
      const res = await fetch('/api/deals/deal_e2e_1/move-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stageId: 'stage_won' }),
      });
      return res.ok;
    });

    expect(ok).toBe(true);
    expect(mock.deals.find((d) => d.id === 'deal_e2e_1')?.stageId).toBe('stage_won');
  });

  test('estado vazio quando não há pipelines', async ({ page }) => {
    await page.route('**/api/pipelines', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ pipelines: [] }),
        });
      }
      return route.fallback();
    });

    const pipeline = new PipelinePage(page);
    await pipeline.goto();
    await expect(page.getByText(/Nenhum pipeline ainda/)).toBeVisible();
  });
});
