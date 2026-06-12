/**
 * Page objects mínimos (F10-S03). Encapsulam só os seletores reais lidos dos
 * componentes de produção — nada de lógica de teste. Preferência por role/texto
 * estável (acessível) sobre CSS; data-attributes quando o componente os expõe
 * (ex.: `MessageBubble` emite `data-direction`/`data-type`).
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/** Login (LoginForm.tsx): inputs por label, submit "Entrar". */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  email(): Locator {
    return this.page.getByLabel('Email');
  }

  password(): Locator {
    return this.page.getByLabel('Senha');
  }

  submit(): Locator {
    return this.page.getByRole('button', { name: 'Entrar' });
  }

  async login(email: string, password: string): Promise<void> {
    await this.email().fill(email);
    await this.password().fill(password);
    await this.submit().click();
  }
}

/** Canais (ChannelsManager.tsx + ConnectWizard.tsx). */
export class ChannelsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/settings/channels');
  }

  connectButton(): Locator {
    return this.page.getByRole('button', { name: 'Conectar canal' });
  }

  /** Item da lista pelo nome do canal (ChannelListItem). */
  channelRow(name: string): Locator {
    return this.page.getByRole('listitem').filter({ hasText: name });
  }

  /**
   * Abre o wizard, escolhe WAHA (sem dependência do SDK da Meta) e conecta.
   * O wizard é um Modal; o botão "Conectar canal" do rodapé submete o form.
   */
  async connectWaha(name: string, sessionId: string, apiKey: string): Promise<void> {
    await this.connectButton().click();
    // Passo 1: escolher provider. O card WAHA tem o label "WhatsApp (WAHA)".
    await this.page.getByRole('button', { name: /WhatsApp \(WAHA\)/ }).click();
    // Passo 2: form WAHA.
    await this.page.getByLabel('Nome do canal').fill(name);
    await this.page.getByLabel('ID da sessão WAHA').fill(sessionId);
    await this.page.getByLabel('Chave de API').fill(apiKey);
    // O botão de submit do form tem o mesmo texto "Conectar canal".
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Conectar canal' })
      .click();
  }
}

/** Inbox / conversa (ConversationsLayout, ChatList, MessageComposer, MessageBubble). */
export class ConversationsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/conversations');
  }

  async open(conversationId: string): Promise<void> {
    await this.page.goto(`/conversations/${conversationId}`);
  }

  chatList(): Locator {
    return this.page.getByRole('list', { name: 'Conversas' });
  }

  /** Item da conversa pelo remoteId exibido (ChatListItem). */
  chatItem(remoteId: string): Locator {
    return this.chatList().getByRole('link').filter({ hasText: remoteId });
  }

  composer(): Locator {
    return this.page.getByPlaceholder('Escreva uma mensagem…');
  }

  sendButton(): Locator {
    return this.page.getByRole('button', { name: 'Enviar mensagem' });
  }

  async sendText(text: string): Promise<void> {
    await this.composer().fill(text);
    await this.sendButton().click();
  }

  /** Bolhas outbound (atendente/agente) — `data-direction="outbound"`. */
  outboundBubbles(): Locator {
    return this.page.locator('[data-direction="outbound"]');
  }

  /** Bolha que contém um texto específico. */
  bubbleWithText(text: string): Locator {
    return this.page.locator('[data-direction]').filter({ hasText: text });
  }

  /** Quickbar de flows manuais (ManualFlowsQuickbar) — botão pelo nome do flow. */
  flowChip(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(name) });
  }

  /** Botão de confirmação do TriggerConfirmModal. */
  confirmTrigger(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Disparar' });
  }
}

/** Pipeline / kanban (PipelinePage, StageColumn, DealCard). */
export class PipelinePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/pipeline');
  }

  /** Coluna de um stage pelo título (h3 dentro da StageColumn). */
  stageColumn(name: string): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByRole('heading', { level: 3, name }) })
      .first();
  }

  /** Card de um deal pelo título. */
  dealCard(title: string): Locator {
    return this.page.getByText(title, { exact: false });
  }

  pipelineSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Selecionar pipeline' });
  }
}

/** Asserção: existe pelo menos uma bolha outbound com o texto dado. */
export async function expectOutboundBubble(page: Page, text: string): Promise<void> {
  const bubble = page.locator('[data-direction="outbound"]').filter({ hasText: text });
  await expect(bubble.first()).toBeVisible();
}
