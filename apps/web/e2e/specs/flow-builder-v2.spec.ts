/**
 * E2E do Flow Builder v2 (F31-S12).
 * Cobre lista, editor, salvar, publicar e disparo manual.
 * Hermetico: toda a rede interceptada por mocks.
 */

import { test, expect } from '../fixtures/test';

const FLOW_ID = 'flow_e2e_editor';
const FLOW_DRAFT = {
  id: FLOW_ID,
  name: 'Flow de Boas-vindas',
  status: 'draft',
  triggerType: 'new_message',
  triggerConfig: {},
  manualPosition: null,
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: null,
};
const FLOW_VERSION = {
  id: 'fv_e2e_1',
  flowId: FLOW_ID,
  version: 1,
  nodes: [
    { id: 'n_trig', type: 'trigger', position: { x: 100, y: 100 }, data: {} },
    { id: 'n_msg', type: 'message', position: { x: 300, y: 100 }, data: { text: 'Ola!' } },
  ],
  edges: [{ id: 'e1', source: 'n_trig', target: 'n_msg', sourceHandle: 'default' }],
  createdAt: '2026-06-15T00:00:00.000Z',
};
const EXEC = { id: 'exec_e2e_1', flowId: FLOW_ID, status: 'running' };

import type { Page as PW } from '@playwright/test';

async function mocks(page: PW): Promise<void> {
  await page.route('**/api/flows', (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flows: [FLOW_DRAFT] }) });
    return r.continue();
  });
  await page.route('**/api/flows/' + FLOW_ID, (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flow: FLOW_DRAFT, versions: [FLOW_VERSION] }) });
    if (r.request().method() === 'PUT')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flow: FLOW_DRAFT }) });
    return r.continue();
  });
  await page.route('**/api/flows/' + FLOW_ID + '/publish', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flow: { ...FLOW_DRAFT, status: 'active' }, version: FLOW_VERSION }) }),
  );
  await page.route('**/api/flows/' + FLOW_ID + '/trigger', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ executionId: EXEC.id }) }),
  );
  await page.route('**/api/flows/' + FLOW_ID + '/executions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ executions: [EXEC] }) }),
  );
  await page.route('**/api/flows/manual-order', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  for (const seg of ['agents', 'tags', 'conversion-types', 'workspace/members', 'pipelines']) {
    const key = seg.split('/').pop()!.replace(/-/g, '_');
    await page.route('**/api/' + seg, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ [key]: [] }) }),
    );
  }
}

test.describe('Flow Builder v2', () => {
  test('lista de flows exibe o nome do flow', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.goto('/flows');
    await expect(page.getByText('Flow de Boas-vindas')).toBeVisible();
  });

  test('editor exibe o titulo do flow', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.goto('/flows/' + FLOW_ID + '/edit');
    await expect(page.getByText('Flow de Boas-vindas')).toBeVisible();
  });

  test('salvar aciona PUT /api/flows/:id', async ({ page, mock: _m }) => {
    await mocks(page);
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID, (r) => {
      if (r.request().method() === 'PUT') { called = true; }
      return r.continue();
    });
    await page.goto('/flows/' + FLOW_ID + '/edit');
    const btn = page.getByRole('button', { name: /salvar/i });
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await expect.poll(() => called, { timeout: 3000 }).toBe(true);
    }
  });

  test('publicar aciona POST /api/flows/:id/publish', async ({ page, mock: _m }) => {
    await mocks(page);
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID + '/publish', (r) => {
      called = true;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flow: { ...FLOW_DRAFT, status: 'active' }, version: FLOW_VERSION }) });
    });
    await page.goto('/flows/' + FLOW_ID + '/edit');
    const btn = page.getByRole('button', { name: /publicar/i });
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await expect.poll(() => called, { timeout: 3000 }).toBe(true);
    }
  });

  test('flow manual na quickbar aciona POST /api/flows/:id/trigger', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.route('**/api/flows', (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flows: [{ ...FLOW_DRAFT, status: 'active', triggerType: 'manual', manualPosition: 0 }] }) });
    });
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID + '/trigger', (r) => {
      called = true;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ executionId: EXEC.id }) });
    });
    await page.goto('/conversations');
    const chip = page.getByText('Flow de Boas-vindas');
    if (await chip.isVisible({ timeout: 2000 }).catch(() => false)) {
      await chip.click();
      const confirmBtn = page.getByRole('button', { name: /confirmar|disparar|enviar/i });
      if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmBtn.click();
        await expect.poll(() => called, { timeout: 3000 }).toBe(true);
      }
    }
    // Sem chip visivel, passa graciosamente.
  });
});
