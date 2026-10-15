/**
 * F70-S37 — a lista e o cabeçalho mostram o nome do contato, não o número.
 * Ambiente `node`: render com `react-dom/server`.
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationDetail, ConversationSummary } from '../../types';

vi.mock('@/shared/stores/auth.store', () => ({ useAuthStore: () => undefined }));
vi.mock('@/features/flow-builder/livechat', () => ({ FlowExecutionsBadge: () => null }));
vi.mock('@hm/ui', () => ({
  Button: () => null,
  useToast: () => ({ toast: () => undefined }),
}));
vi.mock('../../queries', () => ({
  useChangeStatus: () => ({ isPending: false, mutate: () => undefined }),
  useChangeAiMode: () => ({ isPending: false, mutate: () => undefined }),
}));
vi.mock('../SnoozeMenu', () => ({ SnoozeMenu: () => null }));

Reflect.set(globalThis, 'React', React);

const { ChatListItem } = await import('./ChatListItem');
const { ConversationHeader } = await import('../ConversationHeader/ConversationHeader');

const base: ConversationSummary = {
  id: 'c1',
  contactId: 'k1',
  channelId: 'ch1',
  remoteId: '5569999670030',
  contactDisplayName: null,
  contactProfileName: null,
  kind: 'whatsapp',
  status: 'open',
  aiMode: 'off',
  assignedTo: null,
  lastMessagePreview: 'Oi',
  lastMessageAt: null,
  lastMessageFrom: 'contact',
  unreadCount: 0,
};

function item(over: Partial<ConversationSummary>): string {
  return renderToStaticMarkup(
    createElement(ChatListItem, {
      conversation: { ...base, ...over },
      active: false,
      tabIndex: 0,
      focused: false,
    }),
  );
}

describe('ChatListItem — nome do contato', () => {
  it('mostra o nome do sistema, com iniciais e telefone no title', () => {
    const html = item({ contactDisplayName: 'Maria Souza', contactProfileName: 'Mari' });
    expect(html).toContain('Maria Souza');
    expect(html).toContain('>MS<');
    expect(html).toContain('title="+55 (69) 99967-0030"');
    expect(html).not.toContain('>5569999670030<');
  });

  it('sem nome no sistema, mostra o do perfil', () => {
    expect(item({ contactProfileName: 'João' })).toContain('>João<');
  });

  it('sem nome nenhum, telefone formatado e nunca o id cru', () => {
    const html = item({});
    expect(html).toContain('+55 (69) 99967-0030');
    expect(html).not.toContain('5569999670030');
  });
});

function header(over: Partial<ConversationDetail['contact'] & object> | null): string {
  const detail = {
    id: 'c1',
    remoteId: '5569999670030',
    channelProvider: 'meta_whatsapp',
    kind: 'whatsapp',
    status: 'open',
    aiMode: 'off',
    contact:
      over === null
        ? null
        : { id: 'k1', displayName: null, profileName: null, ...over },
  } as unknown as ConversationDetail;
  return renderToStaticMarkup(
    createElement(ConversationHeader, {
      conversationId: 'c1',
      detail,
      panelOpen: false,
      onTogglePanel: () => undefined,
    }),
  );
}

describe('ConversationHeader — nome do contato', () => {
  it('título é o nome; telefone vira subtítulo', () => {
    const html = header({ displayName: 'Maria Souza' });
    expect(html).toContain('Maria Souza');
    expect(html).toContain('+55 (69) 99967-0030');
  });

  it('sem nome: título é o telefone formatado, sem duplicar no subtítulo', () => {
    const html = header({});
    expect(html.match(/\+55 \(69\) 99967-0030/g)?.length).toBe(1);
    expect(html).not.toContain('>5569999670030<');
  });
});

describe('ChatListItem — acessibilidade e avatar (F72-S05)', () => {
  it('é um link dentro de li, sem role=option (nested-interactive)', () => {
    const html = item({ contactDisplayName: 'Maria Souza' });
    expect(html).toMatch(/^<li><a /);
    expect(html).not.toContain('role="option"');
    expect(html).not.toContain('aria-selected');
  });

  it('item ativo expõe aria-current=page', () => {
    const html = renderToStaticMarkup(
      createElement(ChatListItem, { conversation: base, active: true, tabIndex: 0, focused: false }),
    );
    expect(html).toContain('aria-current="page"');
  });

  it('contato sem nome: ícone de pessoa no avatar, sem # nem número', () => {
    const html = item({});
    expect(html).toContain('lucide-user');
    expect(html).not.toContain('>#<');
  });

  it('contato com nome: iniciais, sem ícone de pessoa', () => {
    const html = item({ contactDisplayName: 'Maria Souza' });
    expect(html).toContain('>MS<');
    expect(html).not.toContain('lucide-user');
  });

  it('cor do avatar é a mesma para o mesmo contato', () => {
    const tone = (html: string): string | null => /data-avatar-tone="([^"]+)"/.exec(html)?.[1] ?? null;
    const a = tone(item({ contactId: 'k-42', contactDisplayName: 'Ana' }));
    const b = tone(item({ contactId: 'k-42', contactDisplayName: 'Ana Maria' }));
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('telefone como 2ª linha só quando showPhone (homônimos) e há nome', () => {
    const withName = { ...base, contactDisplayName: 'Maria Souza' };
    const on = renderToStaticMarkup(
      createElement(ChatListItem, { conversation: withName, active: false, tabIndex: 0, focused: false, showPhone: true }),
    );
    const off = item({ contactDisplayName: 'Maria Souza' });
    expect(on).toContain('>+55 (69) 99967-0030<');
    expect(off).not.toContain('>+55 (69) 99967-0030<');
  });

  it('selo de IA e não lidas continuam presentes', () => {
    const html = item({ aiMode: 'on', unreadCount: 3 });
    expect(html).toContain('aria-label="IA ativa"');
    expect(html).toContain('aria-label="3 não lidas"');
  });
});

describe('ChatListItem — roving e selos (F72-S05)', () => {
  it('só o item com foco lógico entra na ordem de Tab', () => {
    const on = renderToStaticMarkup(
      createElement(ChatListItem, { conversation: base, active: false, tabIndex: 0, focused: true }),
    );
    const off = renderToStaticMarkup(
      createElement(ChatListItem, { conversation: base, active: false, tabIndex: -1, focused: false }),
    );
    expect(on).toContain('tabindex="0"');
    expect(off).toContain('tabindex="-1"');
  });

  it('selo de canal pelo provider; `direct` sem provider não chuta canal', () => {
    expect(item({ kind: 'direct', channelProvider: 'meta_whatsapp' })).toContain('aria-label="WhatsApp"');
    expect(item({ kind: 'direct', channelProvider: 'meta_instagram' })).toContain('aria-label="Instagram"');
    const unknown = item({ kind: 'direct' });
    expect(unknown).not.toContain('aria-label="WhatsApp"');
    expect(unknown).not.toContain('aria-label="Instagram"');
  });

  it('comment/story thread: canal dito uma vez só (selo de tipo, sem selo no avatar)', () => {
    for (const kind of ['comment_thread', 'story_thread']) {
      for (const channelProvider of [null, 'meta_instagram']) {
        const html = item({ kind, channelProvider });
        expect(html).not.toContain('aria-label="Instagram"');
        expect(html.match(/Instagram:/g)).toHaveLength(1);
      }
    }
  });

  it('anel do selo acompanha o fundo da linha', () => {
    const idle = item({ kind: 'direct', channelProvider: 'meta_whatsapp' });
    expect(idle).toContain('border-surface group-hover:border-surface-2');
    const on = renderToStaticMarkup(
      createElement(ChatListItem, {
        conversation: { ...base, kind: 'direct', channelProvider: 'meta_whatsapp' },
        active: true,
        tabIndex: 0,
        focused: true,
      }),
    );
    expect(on).toMatch(/border-2 [^"]*border-surface-2/);
    expect(on).not.toContain('group-hover:border-surface-2');
  });

  it('densidade da maquete: avatar 32px e py-2', () => {
    const html = item({ contactDisplayName: 'Maria Souza' });
    expect(html).toContain('size-8');
    expect(html).toMatch(/class="group [^"]*py-2[ "]/);
  });

  it('seleção ativa sem neon nem animação contínua', () => {
    const html = renderToStaticMarkup(
      createElement(ChatListItem, { conversation: base, active: true, tabIndex: 0, focused: true }),
    );
    expect(html).not.toContain('hm-flow-neon');
    expect(html).not.toMatch(/animate-(?!none)/);
    expect(html).not.toContain('shadow-glow');
  });
});
