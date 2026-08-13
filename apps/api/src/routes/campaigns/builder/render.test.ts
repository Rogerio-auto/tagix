import { describe, expect, it } from 'vitest';
import { renderTemplate, type ContactSample } from './render';
import type { TemplateBinding } from './contracts';

const COMPONENTS = [
  { type: 'HEADER', format: 'TEXT', text: 'Olá, {{1}}!' },
  { type: 'BODY', text: 'Seu pedido {{1}} chega em {{2}} dias.' },
  { type: 'FOOTER', text: 'Responda SAIR para não receber mais.' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Quero saber mais' },
      { type: 'URL', text: 'Acompanhar', url: 'https://exemplo.com/pedido/{{1}}' },
    ],
  },
];

const CONTACT: ContactSample = {
  displayName: 'Ana',
  phone: '+5511999998888',
  email: null,
  customFields: { pedido: 'A-123', parcelas: 3 },
};

function binding(
  component: TemplateBinding['component'],
  index: number,
  source: TemplateBinding['source'],
): TemplateBinding {
  return { component, index, source };
}

const FULL: TemplateBinding[] = [
  binding('header', 1, { kind: 'contact', field: 'displayName', fallback: 'cliente' }),
  binding('body', 1, { kind: 'customField', key: 'pedido', fallback: 'seu pedido' }),
  binding('body', 2, { kind: 'fixed', value: '2' }),
  binding('button', 2, { kind: 'customField', key: 'pedido', fallback: 'consulta' }),
];

function render(bindings: TemplateBinding[], contact: ContactSample | null = CONTACT) {
  return renderTemplate({
    name: 'pedido_a_caminho',
    language: 'pt_BR',
    components: COMPONENTS,
    bindings,
    contact,
  });
}

describe('renderTemplate — prévia do modelo aprovado', () => {
  it('substitui variáveis de cabeçalho, corpo e botão', () => {
    const outcome = render(FULL);
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.header).toEqual({ format: 'TEXT', text: 'Olá, Ana!' });
    expect(outcome.preview.body).toBe('Seu pedido A-123 chega em 2 dias.');
    expect(outcome.preview.footer).toBe('Responda SAIR para não receber mais.');
    expect(outcome.preview.buttons[1]?.url).toBe('https://exemplo.com/pedido/A-123');
  });

  it('monta o payload da Graph com parâmetros ordenados e botão com sub_type/index', () => {
    const outcome = render(FULL);
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.outbound).toEqual({
      kind: 'template',
      templateName: 'pedido_a_caminho',
      languageCode: 'pt_BR',
      components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'A-123' },
            { type: 'text', text: '2' },
          ],
        },
        // index 0-based na Graph = posição 2 do binding menos um.
        {
          type: 'button',
          sub_type: 'url',
          index: '1',
          parameters: [{ type: 'text', text: 'A-123' }],
        },
      ],
    });
  });

  it('lista TODAS as variáveis faltando de uma vez', () => {
    const outcome = render([FULL[0]!]);
    if (outcome.ok) throw new Error('esperava pendências');
    expect(outcome.issues.map((issue) => `${issue.component}:${issue.index}`).sort()).toEqual([
      'body:1',
      'body:2',
      'button:2',
    ]);
    expect(outcome.issues.every((issue) => issue.code === 'VARIABLE_MISSING')).toBe(true);
    expect(outcome.issues[0]?.message).toContain('corpo da mensagem');
  });

  it('acusa variável configurada que o modelo não usa', () => {
    const outcome = render([...FULL, binding('body', 9, { kind: 'fixed', value: 'x' })]);
    if (outcome.ok) throw new Error('esperava pendência');
    expect(outcome.issues).toEqual([
      expect.objectContaining({ code: 'VARIABLE_UNUSED', component: 'body', index: 9 }),
    ]);
  });

  it('usa o fallback quando o contato não tem o campo — nunca deixa buraco na frase', () => {
    const outcome = render(FULL, {
      displayName: null,
      phone: null,
      email: null,
      customFields: {},
    });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.header?.text).toBe('Olá, cliente!');
    expect(outcome.preview.body).toBe('Seu pedido seu pedido chega em 2 dias.');
  });

  it('usa o fallback quando o campo existe mas está em branco', () => {
    const outcome = render(FULL, { ...CONTACT, displayName: '   ' });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.header?.text).toBe('Olá, cliente!');
  });

  it('aceita campo personalizado numérico', () => {
    const outcome = render([
      binding('header', 1, { kind: 'fixed', value: 'Ana' }),
      binding('body', 1, { kind: 'customField', key: 'parcelas', fallback: 'algumas' }),
      binding('body', 2, { kind: 'fixed', value: '2' }),
      binding('button', 2, { kind: 'fixed', value: 'A-1' }),
    ]);
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.body).toBe('Seu pedido 3 chega em 2 dias.');
  });

  it('sem contato de amostra, resolve tudo pelos fallbacks', () => {
    const outcome = render(FULL, null);
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.body).toBe('Seu pedido seu pedido chega em 2 dias.');
  });

  it('devolve texto puro — não interpreta markup vindo do modelo', () => {
    const outcome = renderTemplate({
      name: 'x',
      language: 'pt_BR',
      components: [{ type: 'BODY', text: 'Oi {{1}}' }],
      bindings: [binding('body', 1, { kind: 'fixed', value: '<script>alert(1)</script>' })],
      contact: null,
    });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.body).toBe('Oi <script>alert(1)</script>');
  });

  it('cabeçalho de mídia não exige variável e informa o formato', () => {
    const outcome = renderTemplate({
      name: 'x',
      language: 'pt_BR',
      components: [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Chegou!' },
      ],
      bindings: [],
      contact: null,
    });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.header).toEqual({ format: 'IMAGE', text: null });
    expect(outcome.preview.outbound.components).toEqual([]);
  });

  it('modelo sem variável nenhuma renderiza direto', () => {
    const outcome = renderTemplate({
      name: 'x',
      language: 'en_US',
      components: [{ type: 'BODY', text: 'Hello there' }],
      bindings: [],
      contact: null,
    });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.body).toBe('Hello there');
  });

  it('componentes corrompidos no catálogo viram pendência acionável', () => {
    const outcome = renderTemplate({
      name: 'x',
      language: 'pt_BR',
      components: 'não é um array',
      bindings: [],
      contact: null,
    });
    if (outcome.ok) throw new Error('esperava pendência');
    expect(outcome.issues[0]?.code).toBe('TEMPLATE_COMPONENTS_INVALID');
    expect(outcome.issues[0]?.message).toContain('Sincronize');
  });

  it('botão de resposta rápida com variável sai como quick_reply', () => {
    const outcome = renderTemplate({
      name: 'x',
      language: 'pt_BR',
      components: [
        { type: 'BODY', text: 'Oi' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ok', url: 'x/{{1}}' }] },
      ],
      bindings: [binding('button', 1, { kind: 'fixed', value: 'v' })],
      contact: null,
    });
    if (!outcome.ok) throw new Error('esperava prévia válida');
    expect(outcome.preview.outbound.components).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'text', text: 'v' }] },
    ]);
  });
});
