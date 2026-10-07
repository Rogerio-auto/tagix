import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MEDIA, PLAIN, RICH, CHANNEL } from './fixtures';
import type { TemplateBinding, TemplateOption } from './model';
import { PhonePreview } from './PhonePreview';
import { intentFor, isValidTestPhone, normalizeTestPhone, TestSendPanel } from './TestSendPanel';

const BINDINGS: TemplateBinding[] = [
  { component: 'header', index: 1, source: { kind: 'fixed', value: '#2026' } },
  {
    component: 'body',
    index: 1,
    source: { kind: 'contact', field: 'displayName', fallback: 'cliente' },
  },
  { component: 'body', index: 2, source: { kind: 'fixed', value: '3 dias' } },
  { component: 'button', index: 2, source: { kind: 'fixed', value: 'abc' } },
];

function render(template: TemplateOption | null, bindings: readonly TemplateBinding[] = []) {
  return renderToStaticMarkup(
    <PhonePreview
      template={template}
      bindings={bindings}
      contact={null}
      senderName="Loja Exemplo"
    />,
  );
}

// JSX clássico no vitest do @hm/web (ambiente node): o React precisa ser global.
Reflect.set(globalThis, 'React', React);

describe('PhonePreview', () => {
  it('sem modelo convida a escolher', () => {
    expect(render(null)).toContain('Escolha um modelo');
  });

  it('renderiza título, corpo resolvido, rodapé e botões', () => {
    const html = render(RICH, BINDINGS);
    expect(html).toContain('Pedido ');
    expect(html).toContain('#2026');
    expect(html).toContain('cliente');
    expect(html).toContain('3 dias');
    expect(html).toContain('Loja Exemplo');
    expect(html).toContain('data-button-kind="QUICK_REPLY"');
    expect(html).toContain('data-button-kind="URL"');
    expect(html).toContain('https://loja.exemplo/p/abc');
  });

  it('formatação do WhatsApp sai como marcação segura', () => {
    expect(render(PLAIN)).toContain('<strong class="font-semibold">aberta</strong>');
  });

  it('mídia aparece como marcador — nada é carregado de fora', () => {
    const html = render(MEDIA);
    expect(html).toContain('data-media="IMAGE"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('cdn.externo');
    expect(html).toContain('+5511999990000');
  });

  it('variável sem valor fica visível como pendente', () => {
    expect(render(RICH)).toContain('data-missing="true"');
  });

  it('nunca executa HTML vindo do modelo nem do valor digitado', () => {
    const hostile: TemplateOption = {
      id: '10000000-0000-4000-8000-0000000000ff',
      channelId: CHANNEL,
      name: 'hostil',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [
        { type: 'BODY', text: '<script>alert(1)</script> {{1}}' },
        { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'javascript:alert(1)' }] },
      ],
    };
    const html = render(hostile, [
      {
        component: 'body',
        index: 1,
        source: { kind: 'fixed', value: '<img src=x onerror=alert(1)>' },
      },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href=');
  });
});

describe('TestSendPanel', () => {
  it('normaliza e valida o número do teste', () => {
    expect(normalizeTestPhone(' +55 (11) 99999-0000 ')).toBe('+5511999990000');
    expect(isValidTestPhone('+5511999990000')).toBe(true);
    expect(isValidTestPhone(normalizeTestPhone('11 99999-0000'))).toBe(false);
  });

  it('mesma intenção reaproveita a chave; qualquer mudança gera outra', () => {
    let n = 0;
    const make = () => `k${(n += 1)}`;
    const input = { templateId: RICH.id, to: '+5511999990000', bindings: BINDINGS };
    const first = intentFor(null, input, make);
    expect(intentFor(first, input, make)).toBe(first);
    expect(intentFor(first, { ...input, to: '+5511999990001' }, make).key).toBe('k2');
  });

  it('enquanto envia, o botão trava e mostra o andamento', () => {
    const html = renderToStaticMarkup(
      <TestSendPanel
        templateId={RICH.id}
        bindings={[]}
        blockedReason={null}
        defaultPhone="+5511999990000"
        pending
        onSend={() => Promise.resolve({ messageId: 'm', queued: true, replayed: false })}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Enviando…');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });

  it('bloqueado explica o motivo e não deixa enviar', () => {
    const html = renderToStaticMarkup(
      <TestSendPanel
        templateId={RICH.id}
        bindings={[]}
        blockedReason="Salve o rascunho da campanha para liberar o teste."
        pending={false}
        onSend={() => Promise.resolve({ messageId: 'm', queued: true, replayed: false })}
      />,
    );
    expect(html).toContain('Salve o rascunho');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });
});
