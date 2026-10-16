/**
 * F72-S07 — central de notificações no DS 3.0: "Concluir" (escrita no compromisso) em
 * empresa só leitura (absorve F71-S17); "Descartar" é local e segue livre. Ambiente `node`.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import type { AppNotification } from './types';

Reflect.set(globalThis, 'React', React);

const state = { readOnly: false };

vi.mock('@/shared/components/account-banner/useIsReadOnly', () => ({
  useIsReadOnly: () => state.readOnly,
  READ_ONLY_TOOLTIP: 'Modo só leitura: escolha um plano para voltar a editar.',
}));
vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('./queries', () => ({
  useCompleteEvent: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

const { NotificationItem } = await import('./NotificationItem');

const N: AppNotification = {
  eventId: 'e1',
  contactId: 'c1',
  conversationId: 'conv1',
  title: 'Ligar para a Ana',
  type: 'call',
  priority: 'medium',
  startAt: '2026-06-12T12:00:00.000Z',
  receivedAt: 0,
  seen: false,
};

function buttonTag(html: string, label: string): string {
  const at = html.indexOf(label);
  expect(at, label).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', at);
  return html.slice(start, html.indexOf('>', start) + 1);
}

describe('NotificationItem (F72-S07)', () => {
  beforeEach(() => {
    state.readOnly = false;
  });

  it('empresa ativa: "Concluir" habilitado', () => {
    const html = renderToStaticMarkup(<NotificationItem n={N} />);
    expect(buttonTag(html, 'Concluir')).not.toContain('aria-disabled');
  });

  it('só leitura: "Concluir" aria-disabled com a explicação; "Descartar" segue livre', () => {
    state.readOnly = true;
    const html = renderToStaticMarkup(<NotificationItem n={N} />);
    const tag = buttonTag(html, 'Concluir');
    expect(tag).toContain('aria-disabled="true"');
    const id = /aria-describedby="([^"]+)"/.exec(tag)?.[1];
    expect(html).toContain(`id="${id}" role="tooltip"`);
    expect(buttonTag(html, 'Descartar')).not.toContain('aria-disabled');
  });

  it('prioridade média usa o token `warn` (o `bg-warning` não existe no tema)', () => {
    const html = renderToStaticMarkup(<NotificationItem n={N} />);
    expect(html).toContain('bg-warn');
    expect(html).not.toContain('bg-warning');
  });
});
