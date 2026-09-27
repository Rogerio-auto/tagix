/**
 * E2E do Flow Builder v2 (F31-S12).
 * Cobre lista, editor, salvar, publicar e disparo manual.
 * Hermetico: toda a rede interceptada por mocks.
 */

import { test, expect } from '../fixtures/test';

const FLOW_ID = 'flow_e2e_editor';
// Contrato atual (`features/flow-builder/services.ts` ↔ `GET /api/flows/:id`): o
// rascunho editável (nodes/edges) vem na própria linha do flow; `versions` só lista
// as versões publicadas. Com os nodes dentro de `versions`, o editor quebrava em
// `flow.nodes.map` e caía na tela de erro (F70-S29).
const FLOW_DRAFT = {
  id: FLOW_ID,
  name: 'Flow de Boas-vindas',
  description: null,
  status: 'draft',
  triggerType: 'new_message',
  triggerConfig: {},
  manualPosition: null,
  nodes: [
    { id: 'n_trig', type: 'trigger', position: { x: 100, y: 100 }, data: {} },
    { id: 'n_msg', type: 'message', position: { x: 300, y: 100 }, data: { text: 'Ola!' } },
  ],
  edges: [{ id: 'e1', source: 'n_trig', target: 'n_msg', sourceHandle: 'default' }],
  createdAt: '2026-06-15T00:00:00.000Z',
  updatedAt: null,
};
const FLOW_VERSION = {
  id: 'fv_e2e_1',
  version: 1,
  publishedAt: '2026-06-15T00:00:00.000Z',
};
const EXEC = { id: 'exec_e2e_1', flowId: FLOW_ID, status: 'running' };

import type { Page as PW } from '@playwright/test';

async function mocks(page: PW): Promise<void> {
  await page.route('**/api/flows', (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flows: [FLOW_DRAFT] }),
      });
    return r.fallback();
  });
  await page.route('**/api/flows/' + FLOW_ID, (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flow: FLOW_DRAFT, versions: [FLOW_VERSION] }),
      });
    if (r.request().method() === 'PUT')
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flow: FLOW_DRAFT }),
      });
    return r.fallback();
  });
  await page.route('**/api/flows/' + FLOW_ID + '/publish', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flow: { ...FLOW_DRAFT, status: 'active' }, version: FLOW_VERSION }),
    }),
  );
  await page.route('**/api/flows/' + FLOW_ID + '/trigger', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ executionId: EXEC.id }),
    }),
  );
  await page.route('**/api/flows/' + FLOW_ID + '/executions', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ executions: [EXEC] }),
    }),
  );
  await page.route('**/api/flows/manual-order', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );
  for (const seg of ['agents', 'tags', 'conversion-types', 'workspace/members', 'pipelines']) {
    const key = seg.split('/').pop()!.replace(/-/g, '_');
    await page.route('**/api/' + seg, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ [key]: [] }),
      }),
    );
  }
}

test.describe('Flow Builder v2', () => {
  test('lista de flows exibe o nome do flow', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.goto('/flows');
    await expect(page.getByText('Flow de Boas-vindas')).toBeVisible();
  });

  // F70-S29: a rota do editor é `/flows/:id` (não `/flows/:id/edit`, que dá 404), e
  // os testes abaixo tinham `if (visível) { … }` — num 404 passavam sem provar nada.
  // Agora cada um exige o que diz.
  test('editor exibe o titulo do flow', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.goto('/flows/' + FLOW_ID);
    await expect(page.getByText('Flow de Boas-vindas')).toBeVisible();
    await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  });

  test('salvar aciona PUT /api/flows/:id', async ({ page, mock: _m }) => {
    await mocks(page);
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID, (r) => {
      if (r.request().method() === 'PUT') called = true;
      return r.fallback();
    });
    await page.goto('/flows/' + FLOW_ID);
    const save = page.getByRole('button', { name: 'Salvar' });
    // Sem alteração não há o que salvar.
    await expect(save).toBeDisabled();

    // Arrasta o nó de mensagem: o canvas fica com alterações não salvas.
    const node = page.locator('.react-flow__node').filter({ hasText: 'Ola!' });
    const box = await node.boundingBox();
    if (!box) throw new Error('nó de mensagem sem caixa no canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText('Alteracoes nao salvas')).toBeVisible();

    await save.click();
    await expect.poll(() => called).toBe(true);
    await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  });

  test('publicar aciona POST /api/flows/:id/publish', async ({ page, mock: _m }) => {
    await mocks(page);
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID + '/publish', (r) => {
      called = true;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ flow: { ...FLOW_DRAFT, status: 'active' }, version: FLOW_VERSION }),
      });
    });
    await page.goto('/flows/' + FLOW_ID);
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect.poll(() => called).toBe(true);
  });

  test('flow manual na quickbar aciona POST /api/flows/:id/trigger', async ({ page, mock: _m }) => {
    await mocks(page);
    await page.route('**/api/flows', (r) => {
      if (r.request().method() !== 'GET') return r.fallback();
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          flows: [{ ...FLOW_DRAFT, status: 'active', triggerType: 'manual', manualPosition: 0 }],
        }),
      });
    });
    let called = false;
    await page.route('**/api/flows/' + FLOW_ID + '/trigger', (r) => {
      called = true;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ executionId: EXEC.id }),
      });
    });
    // A quickbar vive na conversa aberta, não na lista.
    await page.goto('/conversations/conv_e2e_1');
    await page.getByRole('button', { name: /Flow de Boas-vindas/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Disparar flow' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Disparar' }).click();
    await expect.poll(() => called).toBe(true);
  });
});
