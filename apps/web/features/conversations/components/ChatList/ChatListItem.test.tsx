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
