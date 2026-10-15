/**
 * F72-S07 (sub-lote d) — Canais e Central de Modelos no DS 3.0, com a empresa em só
 * leitura (absorve F71-S17). Render estático (vitest em `node`) com as queries mockadas:
 * conectar, ativar/desativar e remover canal; sincronizar e criar modelo ficam focáveis,
 * `aria-disabled` e descritos pela explicação. Consultar (abrir os modelos, a linha do
 * catálogo) segue livre. A lista de canais continua sendo lista (o Page Object e2e
 * localiza o canal pelo `listitem`) e o catálogo de modelos virou `DataTable`.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import type { Channel } from './types';

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
  useAuthStore: <T,>(sel: (s: { auth: { role: string }; status: string; workspace: null }) => T): T =>
    sel({ auth: { role: state.role }, status: 'authenticated', workspace: null }),
}));
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, isBelowDesktop: false }),
}));
// O detalhe do modelo navega para a campanha nova pelo router (sem App Router no teste).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/settings/channels',
  useSearchParams: () => new URLSearchParams(),
}));
// O assistente de conexão (SDK da Meta, popup) não entra no render estático.
vi.mock('./components/ConnectWizard', () => ({ ConnectWizard: () => null }));

const idle = { isPending: false, mutate: () => undefined, mutateAsync: async () => undefined };

const channel = (over: Partial<Channel>): Channel => ({
  id: 'ch_1',
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
  ...over,
});

const CHANNELS = [
  channel({}),
  channel({ id: 'ch_2', provider: 'waha', name: 'WAHA Suporte', isDefault: false, wahaSessionId: null, phoneNumber: null }),
];

vi.mock('./queries', () => ({
  useChannels: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => undefined,
    data: { channels: CHANNELS },
  }),
  useSetChannelActive: () => idle,
  useDeleteChannel: () => idle,
}));

vi.mock('./message-templates/queries', () => ({
  MessageTemplateApiError: class extends Error {},
  useMessageTemplates: () => ({
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: () => undefined,
    data: {
      templates: [
        {
          id: 'mt_1',
          channelId: 'ch_1',
          name: 'lembrete_consulta',
          language: 'pt_BR',
          category: 'UTILITY',
          status: 'APPROVED',
          isAvailable: true,
          components: [],
          rejectionReason: null,
          lastSyncedAt: '2026-10-10T12:00:00.000Z',
        },
      ],
      pagination: { page: 1, limit: 25, total: 1240, totalPages: 50 },
      syncState: { lastSuccessfulSyncAt: '2026-10-10T12:00:00.000Z' },
    },
  }),
  useSyncMessageTemplates: () => idle,
  useCreateMessageTemplate: () => idle,
}));

const { ChannelsManager } = await import('./components/ChannelsManager');
const { MessageTemplatesCatalog } = await import('./message-templates/MessageTemplatesCatalog');

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`${label}</button>`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function labelled(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `aria-label="${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function expectGuarded(html: string, tag: string): void {
  expect(tag).toContain('aria-disabled="true"');
  expect(tag).not.toMatch(/\sdisabled=""/);
  const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`id="${id}" role="tooltip"`);
}

describe('ChannelsManager (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
    state.role = 'OWNER';
  });

  it('empresa ativa: conectar, desativar e remover sem aria-disabled; contagem em mono', () => {
    const html = renderToStaticMarkup(<ChannelsManager />);
    expect(buttonTag(html, 'Conectar canal')).not.toMatch(/\saria-disabled="/);
    expect(labelled(html, 'Desativar o canal WhatsApp Vendas')).not.toMatch(/\saria-disabled="/);
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">2</);
    expect(html).not.toContain(READ_ONLY_TOOLTIP);
  });

  it('só leitura: conectar, desativar e remover focáveis, aria-disabled e explicados', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<ChannelsManager />);
    expectGuarded(html, buttonTag(html, 'Conectar canal'));
    expectGuarded(html, labelled(html, 'Desativar o canal WhatsApp Vendas'));
    expectGuarded(html, labelled(html, 'Remover canal WhatsApp Vendas'));
    // Consultar os modelos é leitura: o link segue livre.
    expect(html).toContain('href="/settings/channels/ch_1/message-templates"');
  });

  it('lista de canais com status legível (WAHA sem sessão = Desautorizado) e telefone em mono', () => {
    const html = renderToStaticMarkup(<ChannelsManager />);
    expect(html).toContain('aria-label="Canais conectados"');
    expect(html).toContain('Conectado');
    expect(html).toContain('Desautorizado');
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">\+5511999990000</);
  });

  it('papel sem permissão de conectar: nenhum botão de escrita', () => {
    state.role = 'READONLY';
    const html = renderToStaticMarkup(<ChannelsManager />);
    expect(html).toContain('WhatsApp Vendas');
    expect(html).not.toContain('>Conectar canal<');
    expect(html).not.toContain('aria-label="Remover canal WhatsApp Vendas"');
  });
});

describe('MessageTemplatesCatalog (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
    state.role = 'OWNER';
  });

  it('catálogo em DataTable: nome técnico em mono e total formatado pelo idioma', () => {
    const html = renderToStaticMarkup(<MessageTemplatesCatalog channel={CHANNELS[0] as Channel} />);
    expect(html).toContain('<caption class="sr-only">Modelos de mensagem</caption>');
    expect(html).toMatch(/font-mono text-xs text-text-mid">lembrete_consulta</);
    expect(html).toMatch(/1[.,\s]?240/);
  });

  it('só leitura: sincronizar e criar guardados; a linha (consulta) segue abrindo o detalhe', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<MessageTemplatesCatalog channel={CHANNELS[0] as Channel} />);
    expectGuarded(html, buttonTag(html, 'Sincronizar agora'));
    expectGuarded(html, buttonTag(html, 'Criar modelo'));
    expect(html).toContain('aria-label="Ver detalhes de Lembrete consulta"');
  });
});
