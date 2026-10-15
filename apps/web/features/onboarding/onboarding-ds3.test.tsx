/**
 * F72-S07 (sub-lote d) — onboarding no DS 3.0. Render estático (vitest em `node`): o
 * cartão de opção anuncia a seleção (`aria-pressed`) e não depende só da cor (o check
 * aparece), o stepper marca o passo atual com `aria-current` e números em mono, e o
 * "Primeiros passos" mostra a contagem em mono com o trilho na marca. Nenhum hex.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

Reflect.set(globalThis, 'React', React);

vi.mock('@/shared/stores/auth.store', () => ({
  useAuthStore: <T,>(sel: (s: { auth: { role: string; workspaceId: string } }) => T): T =>
    sel({ auth: { role: 'OWNER', workspaceId: 'ws_1' } }),
}));
vi.mock('./checklist/useChecklistDismissed', () => ({
  useChecklistDismissed: () => ({ dismissed: false, dismiss: () => undefined }),
}));
vi.mock('./checklist/queries', () => ({
  useChecklist: () => ({
    isLoading: false,
    isError: false,
    data: {
      steps: [
        { key: 'connect_channel', label: 'Conectar o WhatsApp', done: true, href: '/settings/channels' },
        { key: 'import_contacts', label: 'Importar contatos', done: false, href: '/contacts' },
        { key: 'publish_flow', label: 'Publicar um fluxo', done: false, href: '/flows' },
      ],
    },
  }),
}));

const { OptionCard } = await import('./components/OptionCard');
const { WizardStepper } = await import('./components/WizardStepper');
const { SetupChecklist } = await import('./checklist/SetupChecklist');

describe('Onboarding no DS 3.0 (F72-S07)', () => {
  it('OptionCard: seleção anunciada e marcada além da cor', () => {
    const on = renderToStaticMarkup(<OptionCard selected onSelect={() => undefined} title="Clínica" />);
    const off = renderToStaticMarkup(<OptionCard selected={false} onSelect={() => undefined} title="Clínica" />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('bg-brand-text text-bg');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('text-transparent');
    expect(on + off).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('WizardStepper: passo atual com aria-current e números em mono', () => {
    const html = renderToStaticMarkup(
      <WizardStepper
        steps={[
          { key: 'a', label: 'Boas-vindas' },
          { key: 'b', label: 'Sobre você' },
          { key: 'c', label: 'Seu nicho' },
        ]}
        current={1}
      />,
    );
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(/font-mono[^"]*">2</);
    expect(html).toContain('Passo 2 de 3: Sobre você');
  });

  it('SetupChecklist: contagem em mono e trilho na marca (sem o verde cheio)', () => {
    const html = renderToStaticMarkup(<SetupChecklist />);
    expect(html).toContain('Primeiros passos');
    expect(html).toMatch(/font-mono tabular-nums text-text-mid">1\/3</);
    expect(html).toContain('bg-brand-text');
    expect(html).not.toMatch(/\sbg-brand\s/);
    expect(html).toContain('href="/contacts"');
  });
});
