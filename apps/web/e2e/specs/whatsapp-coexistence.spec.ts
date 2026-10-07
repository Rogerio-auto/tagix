/**
 * F39-S05 — Jornada e2e de conexão do WhatsApp oficial (Cloud API × coexistência)
 * pelo wizard de canais, com a Meta (FB Login / Graph) e a API mockadas.
 *
 * Revisto na F70-S29 para o contrato atual (hotfix `d774835a`, 25/09):
 *
 * - O fluxo modo → signup → finish só existe com o app da Meta configurado no
 *   build (`NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID`, ids PÚBLICOS).
 *   O job `e2e` do CI builda com ids fictícios; sem eles o wizard mostra o aviso de
 *   "conexão automática indisponível" e o spec falha logo no primeiro passo, alto.
 * - O popup da Meta não é aberto: o teste usa "Inserir manualmente", que entrega ao
 *   backend o mesmo contrato do Embedded Signup (`POST /api/channels/whatsapp/connect`).
 *   A fixture aborta `connect.facebook.net`, então nada sai para a Meta.
 * - Não há mais PIN: a Meta recusa `/register` na coexistência e o número novo já
 *   vem provisionado pelo signup (`WaFinishStep`). O passo final pede só o nome.
 * - O campo manual aceita token de System User (`EAA…`, enviado como `accessToken`)
 *   ou o `code` da janela da Meta; `phone_number_id` é opcional (o servidor o
 *   resolve pela WABA).
 */

import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { ChannelsPage } from '../pages/pom';

/** Captura do corpo do último POST a `/api/channels/whatsapp/connect`. */
interface WaConnectCapture {
  body: Record<string, unknown> | null;
  calls: number;
}

/**
 * Mocka a rota `POST /api/channels/whatsapp/connect` (Graph/Meta atrás do backend
 * — aqui totalmente simulada) e torna `GET /api/channels` stateful: o canal criado
 * passa a aparecer ativo na lista. Devolve a captura do corpo para asserções.
 *
 * O `name`/`mode` ecoam o corpo recebido, então a asserção valida o contrato real
 * que o wizard envia (discriminado por `mode`).
 */
async function mockWhatsAppConnect(page: Page): Promise<WaConnectCapture> {
  const capture: WaConnectCapture = { body: null, calls: 0 };
  const created: Record<string, unknown>[] = [];

  // GET stateful: a lista começa com o canal seedado e ganha os recém-criados.
  await page.route('**/api/channels', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        channels: [
          {
            id: 'chan_wa_seed',
            provider: 'meta_whatsapp',
            name: 'WhatsApp Vendas',
            displayHandle: '+55 11 99999-0000',
            phoneNumber: '+5511999990000',
            igUsername: null,
            igAccountType: null,
            wahaSessionId: null,
            isActive: true,
            isDefault: true,
            createdAt: '2026-06-12T12:00:00.000Z',
            updatedAt: null,
          },
          ...created,
        ],
      }),
    });
  });

  await page.route('**/api/channels/whatsapp/connect', (route) => {
    const req: Request = route.request();
    capture.calls += 1;
    const raw = req.postData();
    capture.body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;

    const name = typeof capture.body?.['name'] === 'string' ? capture.body['name'] : 'WhatsApp';
    const channel = {
      id: `chan_wa_new_${created.length}`,
      provider: 'meta_whatsapp' as const,
      name,
      displayHandle: null,
      phoneNumber:
        typeof capture.body?.['phoneNumber'] === 'string' ? capture.body['phoneNumber'] : null,
      igUsername: null,
      igAccountType: null,
      wahaSessionId: null,
      isActive: true,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    created.push(channel);

    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ channel }),
    });
  });

  return capture;
}

/** Abre o wizard, escolhe WhatsApp (Meta) e chega no passo de modo. */
async function openWhatsAppWizard(page: Page): Promise<void> {
  const channels = new ChannelsPage(page);
  await channels.goto();
  await channels.connectButton().click();
  // Card do provider WhatsApp (Meta) — distinto do WhatsApp (WAHA).
  await page.getByRole('button', { name: 'WhatsApp (Meta)' }).click();
  // Primeiro passo do fluxo configurado. Sem os ids públicos da Meta no build, o
  // wizard mostra o aviso de indisponível e esta linha falha (ver cabeçalho).
  await expect(page.getByText('Como você quer conectar o WhatsApp oficial?')).toBeVisible();
}

/** Abre a entrada manual do passo de signup e preenche os dados da Meta. */
async function fillSignupManual(
  page: Page,
  v: { credential: string; wabaId: string; phoneNumberId?: string; phoneNumber?: string },
): Promise<void> {
  const wizard = page.getByRole('dialog', { name: 'Conectar WhatsApp (Meta)' });
  await wizard.getByRole('button', { name: 'Inserir manualmente' }).click();
  const next = wizard.getByRole('button', { name: 'Continuar' });
  // Sem credencial e WABA não há o que levar ao servidor.
  await expect(next).toBeDisabled();
  await wizard.getByLabel('Token de acesso ou authorization code').fill(v.credential);
  if (v.phoneNumberId) await wizard.getByLabel('Phone Number ID (opcional)').fill(v.phoneNumberId);
  await wizard.getByLabel('WABA ID').fill(v.wabaId);
  if (v.phoneNumber) await wizard.getByLabel('Telefone (opcional)').fill(v.phoneNumber);
  await expect(next).toBeEnabled();
  await next.click();
}

test.describe('Conectar WhatsApp oficial (Cloud API × coexistência)', () => {
  test('Cloud API: modo → signup manual com code → nome → canal ativo na lista', async ({
    page,
  }) => {
    const capture = await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);

    // Passo 1: modo Cloud API já vem selecionado por default → Continuar.
    await expect(page.getByRole('button', { name: /Número novo \(Cloud API\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: o CTA da Meta existe; o teste segue pela entrada manual.
    await expect(page.getByRole('button', { name: 'Conectar com a Meta' })).toBeVisible();
    await fillSignupManual(page, {
      credential: 'AUTH_CODE_CLOUD',
      phoneNumberId: '111111111111111',
      wabaId: '222222222222222',
    });

    // Passo 3: só o nome (interno). Submit travado até preencher.
    const submit = page.getByRole('button', { name: 'Conectar WhatsApp' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Nome do canal').fill('Suporte Cloud');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Contrato: mode=cloud_api + code + ids + nome. Nada de PIN.
    await expect(page.getByText('WhatsApp conectado')).toBeVisible();
    expect(capture.calls).toBe(1);
    expect(capture.body).toEqual({
      mode: 'cloud_api',
      code: 'AUTH_CODE_CLOUD',
      phoneNumberId: '111111111111111',
      wabaId: '222222222222222',
      name: 'Suporte Cloud',
    });

    // Canal recém-criado aparece ativo ("Conectado") na lista.
    const row = page.getByRole('listitem').filter({ hasText: 'Suporte Cloud' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Conectado')).toBeVisible();
  });

  test('Coexistência: token de System User, sem phone_number_id → canal ativo + aviso de histórico', async ({
    page,
  }) => {
    const capture = await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);

    // Passo 1: selecionar coexistência. O aviso de sincronização de histórico
    // aparece já na seleção (UX §2.3).
    // Escopo no wizard: o painel de ajuda da tela repete o texto.
    const wizard = page.getByRole('dialog', { name: 'Conectar WhatsApp (Meta)' });
    await wizard.getByRole('button', { name: /Coexistência/ }).click();
    await expect(
      wizard.getByText(/histórico já existente pode levar alguns minutos/i),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: em coexistência o CTA vira "Conectar número existente".
    await expect(page.getByRole('button', { name: 'Conectar número existente' })).toBeVisible();
    await fillSignupManual(page, {
      credential: 'EAAtokenDoUsuarioDoSistema',
      wabaId: '444444444444444',
      phoneNumber: '+5511988887777',
    });

    // Passo 3: o número informado é ecoado; nome.
    await expect(page.getByText('+5511988887777')).toBeVisible();
    await page.getByLabel('Nome do canal').fill('Atendimento Coex');
    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    // Contrato: token `EAA…` segue como `accessToken` (nunca como `code`) e o
    // phone_number_id ausente fica para o servidor resolver pela WABA.
    await expect(page.getByText('WhatsApp conectado')).toBeVisible();
    expect(capture.body).toEqual({
      mode: 'coexistence',
      accessToken: 'EAAtokenDoUsuarioDoSistema',
      wabaId: '444444444444444',
      phoneNumber: '+5511988887777',
      name: 'Atendimento Coex',
    });

    // Toast de coexistência fala explicitamente da sincronização do histórico.
    await expect(page.getByText(/histórico do app pode levar alguns minutos/i)).toBeVisible();

    const row = page.getByRole('listitem').filter({ hasText: 'Atendimento Coex' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Conectado')).toBeVisible();
  });

  test('Voltar no passo final preserva o que foi digitado no signup (UX §2.8)', async ({
    page,
  }) => {
    // O rascunho do "Inserir manualmente" vive no fluxo, não no passo, que desmonta ao
    // avançar (F70-S32; antes era `test.fail`, achado da F70-S29).
    await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await fillSignupManual(page, {
      credential: 'AUTH_CODE_KEEP',
      phoneNumberId: '555555555555555',
      wabaId: '666666666666666',
    });

    // No passo final, "Voltar" retorna ao signup sem perder o que foi digitado.
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Token de acesso ou authorization code')).toHaveValue(
      'AUTH_CODE_KEEP',
    );
    await expect(page.getByLabel('Phone Number ID (opcional)')).toHaveValue('555555555555555');
    await expect(page.getByLabel('WABA ID')).toHaveValue('666666666666666');
  });

  test('Erro 422 da Graph mostra toast e mantém o wizard', async ({ page }) => {
    // Override específico: a rota de connect falha como a Graph recusando a WABA.
    await page.route('**/api/channels/whatsapp/connect', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'WA_CONNECT_WABA_FAILED',
          message: 'A Meta recusou o acesso a esta conta do WhatsApp.',
          ref: 'wa-err-1',
        }),
      }),
    );

    await openWhatsAppWizard(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await fillSignupManual(page, {
      credential: 'AUTH_CODE_FAIL',
      wabaId: '101010101010101',
    });
    await page.getByLabel('Nome do canal').fill('Vai falhar');
    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    // Toast de erro com a mensagem da Meta e o ref; o wizard segue aberto para retry.
    await expect(page.getByText('Falha ao conectar o WhatsApp')).toBeVisible();
    await expect(page.getByText(/A Meta recusou o acesso.*\(ref wa-err-1\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible();
  });
});
