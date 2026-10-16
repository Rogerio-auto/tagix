/**
 * F72-S07 (sub-lote d) — Configurações no DS 3.0 com a empresa em só leitura (absorve
 * F71-S17). Render estático (vitest em `node`) com as queries mockadas:
 *
 *  - configuração do WORKSPACE (workspace, tags, API keys, webhooks, membros): os botões de
 *    escrita ficam focáveis, `aria-disabled` e descritos pela explicação; o select de papel
 *    também (focável, `aria-disabled`, descrito);
 *  - caminho de SAÍDA / conta própria (perfil, sessões): continua liberado, como o servidor
 *    isenta `PATCH /api/members/me` e `DELETE /api/members/me/sessions/:id`;
 *  - listas com cara de tabela viraram `DataTable` com números/datas em mono;
 *  - segredo: a lista de API keys mostra só o prefixo, nunca o token.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';

Reflect.set(globalThis, 'React', React);

const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';
const state = { readOnly: false, role: 'OWNER', mobile: false };

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: <T,>(sel: (s: { auth: { role: string }; workspace: null }) => T): T =>
    sel({ auth: { role: state.role }, workspace: null }),
}));
vi.mock('@/shared/hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({
    isMobile: state.mobile,
    isTablet: false,
    isDesktop: !state.mobile,
    isBelowDesktop: state.mobile,
  }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => undefined }) }));

const idle = { isPending: false, mutate: () => undefined, mutateAsync: async () => undefined, variables: undefined };
const ok = <T,>(data: T) => ({ isLoading: false, isError: false, isFetching: false, data, refetch: () => undefined });

vi.mock('./sections/workspace-org/queries', () => ({
  useWorkspace: () =>
    ok({
      workspace: {
        id: 'ws_1',
        name: 'Clínica Aurora',
        slug: 'aurora',
        industry: null,
        timezone: 'UTC',
        locale: 'pt-BR',
        logoUrl: null,
        settings: {},
      },
    }),
  useUpdateWorkspace: () => idle,
  useMembers: () =>
    ok({
      members: [
        {
          id: 'm1',
          email: 'ana@aurora.test',
          name: 'Ana',
          role: 'OWNER',
          status: 'active',
          avatarUrl: null,
          isOnline: true,
          lastSeenAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'm2',
          email: 'bia@aurora.test',
          name: 'Bia',
          role: 'AGENT',
          status: 'active',
          avatarUrl: null,
          isOnline: false,
          lastSeenAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  useDepartments: () => ok({ departments: [] }),
  useUpdateMember: () => idle,
  useRemoveMember: () => idle,
}));

vi.mock('@/features/invites/queries', () => ({
  useInvites: () =>
    ok({
      invites: [
        {
          id: 'i1',
          email: 'caio@aurora.test',
          role: 'AGENT',
          createdAt: '2026-10-01T00:00:00.000Z',
          expiresAt: '2026-10-08T00:00:00.000Z',
          expired: false,
          lastSentAt: '2026-10-01T00:00:00.000Z',
          sendCount: 1,
          resendsLeft: 3,
        },
      ],
      seats: { used: 2, limit: 5 },
    }),
  useCreateInvite: () => idle,
}));

vi.mock('./sections/workspace-data/queries', () => ({
  useTags: () =>
    ok({
      tags: [{ id: 't1', name: 'VIP', color: '#FFAA00', createdAt: '2026-01-01T00:00:00.000Z', usageCount: 1280 }],
    }),
  useCreateTag: () => idle,
  useUpdateTag: () => idle,
  useDeleteTag: () => idle,
}));

const TOKEN_SECRET = 'hm_live_SEGREDO_QUE_NUNCA_APARECE_NA_LISTA';

vi.mock('./sections/dev/queries', () => ({
  useApiKeys: () =>
    ok({
      apiKeys: [
        {
          id: 'k1',
          name: 'Integração n8n',
          keyPrefix: 'hm_live_ab12',
          scopes: ['read:conversations'],
          rateLimitPerMinute: 1200,
          isActive: true,
          lastUsedAt: '2026-10-10T12:00:00.000Z',
          expiresAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          revokedAt: null,
        },
      ],
    }),
  useCreateApiKey: () => ({ ...idle, mutateAsync: async () => ({ token: TOKEN_SECRET }) }),
  useRevokeApiKey: () => idle,
  useWebhooks: () =>
    ok({
      availableEvents: ['message.received'],
      webhooks: [
        {
          id: 'w1',
          name: 'CRM externo',
          url: 'https://crm.test/hook',
          events: ['message.received'],
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
    }),
  useWebhookDeliveries: () => ok({ deliveries: [] }),
  useCreateWebhook: () => idle,
  useUpdateWebhook: () => idle,
  useDeleteWebhook: () => idle,
  useTestWebhook: () => idle,
}));

vi.mock('./sections/personal/queries', () => ({
  useMe: () =>
    ok({
      member: {
        id: 'm1',
        workspaceId: 'ws_1',
        email: 'ana@aurora.test',
        name: 'Ana',
        role: 'OWNER',
        themePreference: 'dark',
        densityPreference: 'comfortable',
      },
      workspace: { id: 'ws_1' },
    }),
  useUpdateMe: () => idle,
  useChangePassword: () => idle,
  useSessions: () =>
    ok({
      sessions: [
        { id: 'current', current: true, userAgent: 'Chrome no Windows', ipAddress: '189.10.0.1', createdAt: '2026-10-10T12:00:00.000Z' },
      ],
    }),
  useRevokeSession: () => idle,
}));

const { default: WorkspaceSection } = await import('./sections/workspace-org/WorkspaceSection');
const { default: MembersSection } = await import('./sections/workspace-org/MembersSection');
const { default: TagsManager } = await import('./sections/workspace-data/TagsManager');
const { default: ApiKeysManager } = await import('./sections/dev/ApiKeysManager');
const { default: WebhooksManager } = await import('./sections/dev/WebhooksManager');
const { default: ProfileSection } = await import('./sections/personal/ProfileSection');
const { default: SessionsSection } = await import('./sections/personal/SessionsSection');

/** Tag de abertura do `<button>` cujo conteúdo visível termina em `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`${label}</button>`);
  expect(at, `botão "${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

/** Tag de abertura do elemento (`button`/`select`) com este `aria-label`. */
function labelled(html: string, label: string, tag: 'button' | 'select' = 'button'): string {
  const at = html.indexOf(`aria-label="${label}"`);
  expect(at, `${tag} aria-label="${label}"`).toBeGreaterThan(-1);
  const start = html.lastIndexOf(`<${tag}`, at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function expectGuarded(html: string, tag: string): void {
  expect(tag).toContain('aria-disabled="true"');
  expect(tag).not.toMatch(/\sdisabled=""/); // continua focável
  const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`id="${id}" role="tooltip"`);
}

describe('Configurações em só leitura (F72-S07 · F71-S17)', () => {
  beforeEach(() => {
    state.readOnly = true;
    state.role = 'OWNER';
    state.mobile = false;
  });

  it('workspace: "Salvar workspace" focável, aria-disabled e explicado', () => {
    const html = renderToStaticMarkup(<WorkspaceSection />);
    expectGuarded(html, buttonTag(html, 'Salvar workspace'));
    expect(html).toContain(READ_ONLY_TOOLTIP);
  });

  it('membros: convidar, papel, remover e as ações do convite ficam guardados', () => {
    const html = renderToStaticMarkup(<MembersSection />);
    expectGuarded(html, buttonTag(html, 'Convidar membro'));
    expectGuarded(html, labelled(html, 'Papel de bia@aurora.test', 'select'));
    expectGuarded(html, labelled(html, 'Remover bia@aurora.test'));
    expectGuarded(html, labelled(html, 'Reenviar convite para caio@aurora.test'));
    expectGuarded(html, labelled(html, 'Copiar link do convite de caio@aurora.test'));
    expectGuarded(html, labelled(html, 'Revogar convite de caio@aurora.test'));
  });

  it('tags: adicionar, editar e excluir guardados', () => {
    const html = renderToStaticMarkup(<TagsManager />);
    expectGuarded(html, buttonTag(html, 'Adicionar'));
    expectGuarded(html, labelled(html, 'Editar tag VIP'));
    expectGuarded(html, labelled(html, 'Excluir tag VIP'));
  });

  it('dev: nova chave, revogar, novo webhook, testar, editar e remover guardados; o log segue livre', () => {
    const keys = renderToStaticMarkup(<ApiKeysManager />);
    expectGuarded(keys, buttonTag(keys, 'Nova chave'));
    expectGuarded(keys, labelled(keys, 'Revogar a chave Integração n8n'));

    const hooks = renderToStaticMarkup(<WebhooksManager />);
    expectGuarded(hooks, buttonTag(hooks, 'Novo webhook'));
    expectGuarded(hooks, labelled(hooks, 'Testar o webhook CRM externo'));
    expectGuarded(hooks, labelled(hooks, 'Editar o webhook CRM externo'));
    expectGuarded(hooks, labelled(hooks, 'Remover o webhook CRM externo'));
    expect(labelled(hooks, 'Ver o log de entregas de CRM externo')).not.toMatch(/\saria-disabled="/);
  });

  it('conta própria segue liberada: salvar perfil e encerrar sessão sem aria-disabled', () => {
    const profile = renderToStaticMarkup(<ProfileSection />);
    expect(buttonTag(profile, 'Salvar perfil')).not.toMatch(/\saria-disabled="/);
    expect(profile).not.toContain(READ_ONLY_TOOLTIP);

    const sessions = renderToStaticMarkup(<SessionsSection />);
    expect(labelled(sessions, 'Encerrar a sessão deste dispositivo')).not.toMatch(/\saria-disabled="/);
    expect(sessions).not.toContain(READ_ONLY_TOOLTIP);
  });

  it('empresa ativa: nada guardado', () => {
    state.readOnly = false;
    const html = renderToStaticMarkup(<MembersSection />);
    expect(buttonTag(html, 'Convidar membro')).not.toMatch(/\saria-disabled="/);
    expect(labelled(html, 'Papel de bia@aurora.test', 'select')).not.toMatch(/\saria-disabled="/);
    expect(html).not.toContain(READ_ONLY_TOOLTIP);
  });
});

describe('Configurações no DS 3.0 (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
    state.mobile = false;
  });

  it('tags em DataTable: uso em mono e formatado pelo idioma, cor do dado só na pastilha', () => {
    const html = renderToStaticMarkup(<TagsManager />);
    expect(html).toContain('<caption class="sr-only">Tags</caption>');
    expect(html).toMatch(/font-mono tabular-nums">1[.,\s]?280</);
    // A cor é dado do cliente (pastilha); o seletor de cor nova não traz hex próprio.
    expect(html).toContain('background-color:#FFAA00');
    expect(html.replace(/#FFAA00/g, '')).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('API keys: DataTable com prefixo e limite em mono; o token nunca aparece na lista', () => {
    const html = renderToStaticMarkup(<ApiKeysManager />);
    expect(html).toContain('<caption class="sr-only">API keys</caption>');
    expect(html).toContain('hm_live_ab12…');
    expect(html).toMatch(/1[.,\s]?200\/min/);
    expect(html).not.toContain(TOKEN_SECRET);
  });

  it('sessões: IP em mono e a sessão atual marcada', () => {
    const html = renderToStaticMarkup(<SessionsSection />);
    expect(html).toContain('<caption class="sr-only">Sessões ativas</caption>');
    expect(html).toMatch(/font-mono[^"]*">189\.10\.0\.1</);
    expect(html).toContain('Este dispositivo');
  });

  it('membros no celular: cards (sem tabela) com o selo de status e o papel', () => {
    state.mobile = true;
    const html = renderToStaticMarkup(<MembersSection />);
    expect(html).not.toContain('<caption class="sr-only">Membros</caption>');
    expect(html).toContain('bia@aurora.test');
    expect(html).toContain('Ativo');
    expect(html).toContain('de 5 vagas em uso');
  });
});
