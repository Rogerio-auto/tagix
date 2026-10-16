/**
 * F72-S07 (sub-lote b) — campanhas no DS 3.0: botões de escrita em empresa só leitura
 * (absorve F71-S17), a lista como `DataTable` (números em mono à direita) e o
 * monitoramento com números no idioma da interface. Ambiente `node`: render estático.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';

Reflect.set(globalThis, 'React', React);

const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';
const state = { readOnly: false, role: 'OWNER' };

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: <T,>(sel: (s: { auth: { role: string } }) => T): T => sel({ auth: { role: state.role } }),
}));
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, isBelowDesktop: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const mutation = { isPending: false, mutate: () => undefined };
const campaign = (id: string, name: string, status: string, rate: number, daily: number | null) => ({
  id,
  workspaceId: 'ws_1',
  channelId: 'ch_1',
  name,
  type: 'broadcast',
  status,
  rateLimitPerMinute: rate,
  dailyLimit: daily,
  autoHandoffOnReply: false,
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: null,
});

vi.mock('./list/queries', () => ({
  campaignKeys: { detail: (id: string) => ['campaign', id] },
  useCampaigns: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: {
      campaigns: [
        campaign('cp_1', 'Black Friday', 'running', 1200, 25000),
        campaign('cp_2', 'Reativação', 'draft', 30, null),
      ],
    },
  }),
  useCampaignMetrics: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: {
      metrics: {
        campaignId: 'cp_1',
        totalRecipients: 12480,
        messagesQueued: 120,
        messagesSent: 12000,
        messagesDelivered: 11520,
        messagesRead: 8000,
        messagesReplied: 940,
        messagesFailed: 36,
        messagesBlocked: 4,
        deliveryRate: '96.00',
        readRate: '69.4',
        responseRate: '8.2',
        blockRate: '0.03',
        healthStatus: 'healthy',
        updatedAt: '2026-06-12T12:00:00.000Z',
      },
    },
  }),
  useCampaignDeliveries: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: {
      deliveries: [
        {
          id: 'dl_1',
          campaignId: 'cp_1',
          status: 'failed',
          errorCode: '131026',
          errorMessage: 'Destinatário não tem WhatsApp.',
          queuedAt: '2026-06-12T12:00:00.000Z',
          sentAt: null,
          failedAt: '2026-06-12T12:05:00.000Z',
        },
      ],
    },
  }),
  usePauseCampaign: () => mutation,
  useResumeCampaign: () => mutation,
  useCancelCampaign: () => mutation,
}));

const { CampaignsPage } = await import('./list/CampaignsPage');
const { CampaignMonitoring } = await import('./monitoring/CampaignMonitoring');

/** Tag de abertura do `<button>` cujo conteúdo contém `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

/** Tag de abertura do `<button>` com este `aria-label`. */
function labelledButton(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `botão aria-label="${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function expectGuarded(html: string, tag: string): void {
  expect(tag).toContain('aria-disabled="true"');
  expect(tag).not.toMatch(/\sdisabled=""/); // continua focável
  const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`id="${id}" role="tooltip"`);
}

describe('CampaignsPage (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
    state.role = 'OWNER';
  });

  it('empresa ativa: criar e pausar sem aria-disabled', () => {
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(buttonTag(html, 'Nova campanha')).not.toContain('aria-disabled');
    expect(labelledButton(html, 'Pausar Black Friday')).not.toContain('aria-disabled');
  });

  it('só leitura: criar, pausar, editar e cancelar ficam focáveis, aria-disabled e explicados', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<CampaignsPage />);
    expectGuarded(html, buttonTag(html, 'Nova campanha'));
    expectGuarded(html, labelledButton(html, 'Pausar Black Friday'));
    expectGuarded(html, labelledButton(html, 'Cancelar Black Friday'));
    expectGuarded(html, labelledButton(html, 'Editar Reativação'));
    expect(html).toContain(READ_ONLY_TOOLTIP);
  });

  it('SUPERVISOR cria e pausa, mas não cancela (campaign.cancel é só de admin)', () => {
    state.role = 'SUPERVISOR';
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(html).toContain('>Nova campanha<');
    expect(html).toContain('aria-label="Pausar Black Friday"');
    expect(html).not.toContain('aria-label="Cancelar Black Friday"');
  });

  it('papel só de leitura (READONLY): lista sem nenhuma ação de escrita', () => {
    state.role = 'READONLY';
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(html).toContain('Black Friday');
    expect(html).not.toContain('>Nova campanha<');
    expect(html).not.toMatch(/aria-label="(Pausar|Cancelar|Editar) /);
  });

  it('desktop: DataTable com ritmo e limite em mono à direita', () => {
    const html = renderToStaticMarkup(<CampaignsPage />);
    expect(html).toContain('<caption class="sr-only">Campanhas</caption>');
    expect(html).toContain('Black Friday');
    expect(html).toMatch(/text-right[^"]*font-price tabular-nums/);
    // Número formatado pelo idioma da interface (sem locale literal): 1200 com separador.
    expect(html).toMatch(/1[.,\s]?200/);
  });
});

describe('CampaignMonitoring (F72-S07)', () => {
  it('volume e taxas em mono; taxa vem como porcentagem do idioma, não toFixed', () => {
    const html = renderToStaticMarkup(<CampaignMonitoring campaignId="cp_1" />);
    expect(html).toContain('Destinatários');
    expect(html).toMatch(/font-mono[^"]*tabular-nums[^"]*">12[.,\s]?480</);
    expect(html).toMatch(/>96(\.0)?\s?%</);
    expect(html).toContain('Saudável');
    expect(html).toContain('<caption class="sr-only">Erros recentes da Meta</caption>');
    expect(html).toContain('131026');
  });
});
