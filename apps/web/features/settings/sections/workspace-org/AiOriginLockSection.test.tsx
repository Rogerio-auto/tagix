/**
 * F70-S30 — tela da trava de origem (Configurações → IA). O vitest do @hm/web roda em
 * `node` (sem DOM): renderizamos para HTML estático com as queries mockadas e checamos o
 * interruptor, o texto explicativo e a última alteração; e a seção no registry.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@hm/ui';
import type { AiOriginLock } from './queries';

// O vitest do @hm/web compila JSX no modo clássico (`React.createElement`), e o Next
// usa o automático — o componente não importa `React`. Só para este render no node.
Reflect.set(globalThis, 'React', React);

const state: { data: AiOriginLock } = {
  data: { aiRequiresProvenOrigin: true, lastChange: null },
};

vi.mock('./queries', () => ({
  useAiOriginLock: () => ({
    isLoading: false,
    isError: false,
    data: state.data,
    refetch: () => undefined,
  }),
  useSetAiOriginLock: () => ({ isPending: false, mutateAsync: async () => undefined }),
}));

vi.mock('@hm/ui', async (orig) => {
  const actual = await orig<typeof Ui>();
  return { ...actual, useToast: () => ({ toast: () => undefined }) };
});

const { default: AiOriginLockSection } = await import('./AiOriginLockSection');

describe('AiOriginLockSection (F70-S30)', () => {
  beforeEach(() => {
    state.data = { aiRequiresProvenOrigin: true, lastChange: null };
  });

  it('trava ligada: interruptor marcado, frase recomendada e padrão explicado', () => {
    const html = renderToStaticMarkup(<AiOriginLockSection />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Responder só quem chegou por anúncio, site ou Instagram');
    expect(html).toContain('Recomendado se este número também é pessoal');
    expect(html).toContain('Nunca alterada. Todo workspace começa com a trava ligada.');
  });

  it('trava desligada: interruptor desmarcado, aviso e autor da última alteração', () => {
    state.data = {
      aiRequiresProvenOrigin: false,
      lastChange: {
        at: '2026-09-25T17:02:00.000Z',
        byName: 'Ana Souza',
        byEmail: 'ana@example.test',
        previous: true,
        next: false,
      },
    };
    const html = renderToStaticMarkup(<AiOriginLockSection />);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Trava desligada: qualquer pessoa');
    expect(html).toContain('Ana Souza desligou a trava em');
  });

  it('não usa cor fixa (só tokens do DS v2)', () => {
    const html = renderToStaticMarkup(<AiOriginLockSection />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('registry de configurações', () => {
  it('a seção IA existe e só abre para quem edita o workspace (OWNER/ADMIN)', async () => {
    const { findSection } = await import('../../shell/registry');
    const section = findSection('ia');
    expect(section).toMatchObject({ group: 'workspace', label: 'IA', permission: 'workspace.edit' });
    expect(section?.component).toBeDefined();
  });
});
