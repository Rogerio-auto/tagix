/**
 * F39-S05 — Jornada e2e de conexão do WhatsApp oficial (Cloud API × coexistência)
 * pelo wizard de canais, com a Meta (FB Login / Graph) e a API mockadas.
 *
 * Contexto de execução: o SDK da Meta NÃO está instalado neste monorepo
 * (`isFbSdkAvailable()` é sempre `false` em `features/channels/fb-login.ts`),
 * então o botão "Entrar com a Meta" fica desabilitado e o wizard cai no **modo
 * manual** — o operador cola `code` + `phone_number_id` + `waba_id` do painel da
 * Meta. Esse é exatamente o mesmo contrato que o Embedded Signup real entrega ao
 * backend (`POST /api/channels/whatsapp/connect`), então a jornada de teste
 * exercita o caminho de produção de ponta a ponta sem o SDK.
 *
 * O `installApiMocks` (fixture base) NÃO modela `/api/channels/whatsapp/connect`
 * (rota nova da F39); por isso cada teste instala um override `page.route` ANTES
 * de navegar — capturando o corpo enviado para asserções de contrato — e torna o
 * GET `/api/channels` stateful para o canal recém-criado aparecer ativo na lista
 * após a invalidação do React Query (mesmo padrão de `channels.spec.ts`).
 *
 * ⚠️ A suíte Playwright não hidrata no host Windows local (ver memória
 * `e2e-no-hydration-this-host`); o valor entregue aqui é o spec autorado correto
 * + typecheck/lint/build verdes. A execução verde fica para CI/Linux.
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
 * que o wizard envia (discriminado por `mode`, com `pin` de 6 dígitos).
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
}

/**
 * Preenche o passo manual do Embedded Signup (code + ids) e avança até o passo
 * final (PIN + nome). O botão "Entrar com a Meta"/"Conectar número existente"
 * está desabilitado (SDK indisponível) — usamos o form manual.
 */
async function fillSignupManual(
  page: Page,
  v: { code: string; phoneNumberId: string; wabaId: string; phoneNumber?: string },
): Promise<void> {
  await page.getByLabel('Authorization code').fill(v.code);
  await page.getByLabel('Phone Number ID').fill(v.phoneNumberId);
  await page.getByLabel('WABA ID').fill(v.wabaId);
  if (v.phoneNumber) await page.getByLabel('Telefone (opcional)').fill(v.phoneNumber);
  // O passo de signup tem seu próprio "Continuar" (submit do form manual).
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
}

test.describe('Conectar WhatsApp oficial (Cloud API × coexistência)', () => {
  test('Cloud API: modo → signup manual → PIN → canal ativo na lista', async ({ page }) => {
    const capture = await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);

    // Passo 1: modo Cloud API já vem selecionado por default → Continuar.
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: Embedded Signup indisponível → entrada manual.
    await expect(
      page.getByRole('button', { name: 'Entrar com a Meta' }),
    ).toBeDisabled();
    await fillSignupManual(page, {
      code: 'AUTH_CODE_CLOUD',
      phoneNumberId: '111111111111111',
      wabaId: '222222222222222',
    });

    // Passo 3: PIN (6 dígitos) + nome. Submit fica travado até ambos válidos.
    const submit = page.getByRole('button', { name: 'Conectar WhatsApp' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Nome do canal').fill('Suporte Cloud');
    await page.getByLabel('PIN do WhatsApp (6 dígitos)').fill('123456');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Contrato: o wizard envia mode=cloud_api + os ids + pin de 6 dígitos.
    await expect(page.getByText('WhatsApp conectado')).toBeVisible();
    expect(capture.calls).toBe(1);
    expect(capture.body).toMatchObject({
      mode: 'cloud_api',
      code: 'AUTH_CODE_CLOUD',
      phoneNumberId: '111111111111111',
      wabaId: '222222222222222',
      pin: '123456',
      name: 'Suporte Cloud',
    });

    // Canal recém-criado aparece ativo ("Conectado") na lista.
    const row = page.getByRole('listitem').filter({ hasText: 'Suporte Cloud' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Conectado')).toBeVisible();
  });

  test('Coexistência: modo coexistência → signup manual → PIN → canal ativo + aviso de histórico', async ({
    page,
  }) => {
    const capture = await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);

    // Passo 1: selecionar coexistência. O aviso de sincronização de histórico
    // aparece já na seleção (UX §2.3).
    await page.getByRole('button', { name: /Coexistência/ }).click();
    await expect(page.getByText(/histórico já existente pode levar alguns minutos/i)).toBeVisible();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Passo 2: em coexistência o CTA do signup vira "Conectar número existente"
    // (também desabilitado sem SDK) → manual, com o número exibido.
    await expect(
      page.getByRole('button', { name: 'Conectar número existente' }),
    ).toBeDisabled();
    await fillSignupManual(page, {
      code: 'AUTH_CODE_COEX',
      phoneNumberId: '333333333333333',
      wabaId: '444444444444444',
      phoneNumber: '+5511988887777',
    });

    // Passo 3: o número selecionado é ecoado; PIN + nome.
    await expect(page.getByText('+5511988887777')).toBeVisible();
    await page.getByLabel('Nome do canal').fill('Atendimento Coex');
    await page.getByLabel('PIN do WhatsApp (6 dígitos)').fill('654321');
    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    // Contrato: mode=coexistence, com phoneNumber capturado no signup.
    await expect(page.getByText('WhatsApp conectado')).toBeVisible();
    expect(capture.body).toMatchObject({
      mode: 'coexistence',
      code: 'AUTH_CODE_COEX',
      phoneNumberId: '333333333333333',
      wabaId: '444444444444444',
      phoneNumber: '+5511988887777',
      pin: '654321',
      name: 'Atendimento Coex',
    });

    // Toast de coexistência fala explicitamente da sincronização do histórico.
    await expect(page.getByText(/histórico do app pode levar alguns minutos/i)).toBeVisible();

    const row = page.getByRole('listitem').filter({ hasText: 'Atendimento Coex' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Conectado')).toBeVisible();
  });

  test('Voltar no passo de PIN preserva o code/ids capturados (UX §2.8)', async ({ page }) => {
    await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await fillSignupManual(page, {
      code: 'AUTH_CODE_KEEP',
      phoneNumberId: '555555555555555',
      wabaId: '666666666666666',
    });

    // No passo final, "Voltar" retorna ao signup sem perder o que foi digitado.
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Authorization code')).toHaveValue('AUTH_CODE_KEEP');
    await expect(page.getByLabel('Phone Number ID')).toHaveValue('555555555555555');
    await expect(page.getByLabel('WABA ID')).toHaveValue('666666666666666');
  });

  test('PIN não-numérico/curto não habilita o submit (guard de 6 dígitos)', async ({ page }) => {
    await mockWhatsAppConnect(page);
    await openWhatsAppWizard(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await fillSignupManual(page, {
      code: 'AUTH_CODE_PIN',
      phoneNumberId: '777777777777777',
      wabaId: '888888888888888',
    });

    await page.getByLabel('Nome do canal').fill('PIN curto');
    const pin = page.getByLabel('PIN do WhatsApp (6 dígitos)');
    const submit = page.getByRole('button', { name: 'Conectar WhatsApp' });

    // O input filtra não-dígitos e limita a 6; 5 dígitos não habilita.
    await pin.fill('12ab3');
    await expect(pin).toHaveValue('123');
    await expect(submit).toBeDisabled();

    // Completa para 6 dígitos → habilita.
    await pin.fill('123456');
    await expect(submit).toBeEnabled();
  });

  test('Erro 422 da Graph (register/subscribe) mostra toast e mantém o wizard', async ({ page }) => {
    // Override específico: a rota de connect falha como a Graph recusando o PIN.
    await page.route('**/api/channels/whatsapp/connect', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'WA_CONNECT_REGISTER_FAILED',
          message: 'A Meta recusou o register do número (PIN incorreto).',
          ref: 'wa-err-1',
        }),
      }),
    );

    await openWhatsAppWizard(page);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await fillSignupManual(page, {
      code: 'AUTH_CODE_FAIL',
      phoneNumberId: '999999999999999',
      wabaId: '101010101010101',
    });
    await page.getByLabel('Nome do canal').fill('Vai falhar');
    await page.getByLabel('PIN do WhatsApp (6 dígitos)').fill('000000');
    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    // Toast de erro com a mensagem da Meta; o wizard segue aberto para retry.
    await expect(page.getByText('Falha ao conectar o WhatsApp')).toBeVisible();
    await expect(page.getByText(/A Meta recusou o register/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible();
  });
});
