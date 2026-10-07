/**
 * F58-S12 — variáveis resolvidas por destinatário + portão do modelo (unit, sem banco).
 */
import { describe, expect, it } from 'vitest';
import { parseOutboundJob } from '../../outbound/job';
import {
  catalogBlockReason,
  decodeBindingContract,
  normalizeParameter,
  renderRecipientComponents,
  templateFailureReason,
  type RecipientContact,
  type TemplateBinding,
} from './index';

/** Modelo como a Meta sincroniza (mesmo formato do teste da prévia da API). */
const CATALOG = [
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

const BINDINGS: TemplateBinding[] = [
  {
    component: 'header',
    index: 1,
    source: { kind: 'contact', field: 'displayName', fallback: 'cliente' },
  },
  { component: 'body', index: 2, source: { kind: 'fixed', value: '2' } },
  {
    component: 'body',
    index: 1,
    source: { kind: 'customField', key: 'pedido', fallback: 'seu pedido' },
  },
  {
    component: 'button',
    index: 2,
    source: { kind: 'customField', key: 'pedido', fallback: 'consulta' },
  },
];

/** Exatamente o que o criador grava em `campaign_steps.template_components`. */
const STEP = [{ type: 'binding_contract', version: 1, bindings: BINDINGS }];

const ANA: RecipientContact = {
  displayName: 'Ana',
  phone: '+5511999998888',
  email: null,
  customFields: { pedido: 'A-123' },
};
const BRUNO: RecipientContact = {
  displayName: 'Bruno',
  phone: '+5511999997777',
  email: 'b@x.com',
  customFields: { pedido: 'B-9' },
};
const SEM_DADOS: RecipientContact = {
  displayName: null,
  phone: null,
  email: null,
  customFields: {},
};

function render(contact: RecipientContact, catalog: unknown = CATALOG) {
  const out = renderRecipientComponents({
    stepComponents: STEP,
    catalogComponents: catalog,
    contact,
  });
  if (!out.ok) throw new Error(`esperava render ok: ${out.reason}`);
  return out.components;
}

describe('renderRecipientComponents — variáveis por destinatário', () => {
  it('monta header/body ordenados e botão com sub_type/index 0-based', () => {
    expect(render(ANA)).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'A-123' },
          { type: 'text', text: '2' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '1',
        parameters: [{ type: 'text', text: 'A-123' }],
      },
    ]);
  });

  it('cada contato recebe os PRÓPRIOS valores — nada vaza de um render para o outro', () => {
    const a = render(ANA);
    const b = render(BRUNO);
    const a2 = render(ANA);
    expect(JSON.stringify(b)).toContain('Bruno');
    expect(JSON.stringify(b)).toContain('B-9');
    expect(JSON.stringify(b)).not.toContain('Ana');
    expect(JSON.stringify(b)).not.toContain('A-123');
    // Renderizar Bruno no meio não altera o resultado de Ana.
    expect(a2).toEqual(a);
  });

  it('campo vazio/ausente cai no fallback obrigatório (nunca buraco na frase)', () => {
    const c = render(SEM_DADOS);
    expect(c[0]).toEqual({ type: 'header', parameters: [{ type: 'text', text: 'cliente' }] });
    expect(c[1]?.parameters?.[0]).toEqual({ type: 'text', text: 'seu pedido' });
    expect(c[2]?.parameters?.[0]).toEqual({ type: 'text', text: 'consulta' });
    const espacos = render({ ...ANA, displayName: '   \n\t ' });
    expect(espacos[0]?.parameters?.[0]).toEqual({ type: 'text', text: 'cliente' });
  });

  it('campo personalizado numérico/booleano vira texto; objeto cai no fallback', () => {
    const num = render({ ...ANA, customFields: { pedido: 42 } });
    expect(num[1]?.parameters?.[0]).toEqual({ type: 'text', text: '42' });
    const obj = render({ ...ANA, customFields: { pedido: { x: 1 } } });
    expect(obj[1]?.parameters?.[0]).toEqual({ type: 'text', text: 'seu pedido' });
  });

  it('normaliza o que a Graph recusa em parâmetro (quebra de linha, tab, 4+ espaços)', () => {
    expect(normalizeParameter('linha 1\nlinha 2\tfim     x')).toBe('linha 1 linha 2 fim   x');
    const c = render({ ...ANA, displayName: 'Ana\nMaria' });
    expect(c[0]?.parameters?.[0]).toEqual({ type: 'text', text: 'Ana Maria' });
  });

  it('modelo alterado na Meta (variável a mais ou a menos) => template_variables_mismatch', () => {
    const semBotao = CATALOG.slice(0, 3);
    const out = renderRecipientComponents({
      stepComponents: STEP,
      catalogComponents: semBotao,
      contact: ANA,
    });
    expect(out).toEqual({ ok: false, reason: 'template_variables_mismatch', detail: ['button:2'] });

    const corpoNovo = [
      { type: 'BODY', text: 'Oi {{1}} {{2}} {{3}}' },
      ...CATALOG.slice(0, 1),
      CATALOG[3],
    ];
    const out2 = renderRecipientComponents({
      stepComponents: STEP,
      catalogComponents: corpoNovo,
      contact: ANA,
    });
    expect(out2.ok).toBe(false);
    if (!out2.ok) expect(out2.detail).toContain('body:3');
  });

  it('sem modelo no catálogo: renderiza mesmo assim (botão com variável é url)', () => {
    const c = render(ANA, null);
    expect(c[2]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '1',
      parameters: [{ type: 'text', text: 'A-123' }],
    });
  });

  it('contrato corrompido nunca vai cru para a Graph', () => {
    const out = renderRecipientComponents({
      stepComponents: [{ type: 'binding_contract', version: 99, bindings: [] }],
      catalogComponents: CATALOG,
      contact: ANA,
    });
    expect(out).toMatchObject({ ok: false, reason: 'template_components_invalid' });
  });

  it('passo legado (componentes da Graph prontos) segue como está, preservando sub_type/index', () => {
    const legacy = [
      { type: 'body', parameters: [{ type: 'text', text: 'oi' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'x' }] },
    ];
    const out = renderRecipientComponents({
      stepComponents: legacy,
      catalogComponents: null,
      contact: ANA,
    });
    expect(out).toEqual({ ok: true, components: legacy });
    expect(
      renderRecipientComponents({ stepComponents: [], catalogComponents: null, contact: ANA }),
    ).toEqual({
      ok: true,
      components: [],
    });
    expect(
      renderRecipientComponents({
        stepComponents: [{ type: 'carousel' }],
        catalogComponents: null,
        contact: ANA,
      }),
    ).toMatchObject({ ok: false, reason: 'template_components_invalid' });
  });

  it('decodeBindingContract só aceita o envelope v1 válido', () => {
    expect(decodeBindingContract(STEP)).toEqual(BINDINGS);
    expect(decodeBindingContract([])).toBeNull();
    expect(decodeBindingContract([{ type: 'body' }])).toBeNull();
    expect(
      decodeBindingContract([
        { type: 'binding_contract', version: 1, bindings: [{ component: 'x' }] },
      ]),
    ).toBeNull();
  });
});

describe('sub_type/index sobrevivem até o adapter (job do outbound)', () => {
  it('o parse do job no consumo NÃO descarta sub_type/index do botão', () => {
    const job = parseOutboundJob({
      kind: 'template',
      channelId: 'c',
      conversationId: 'v',
      messageId: 'm',
      chatId: '5511',
      templateName: 'pedido',
      languageCode: 'pt_BR',
      components: render(ANA),
    });
    if (job.kind !== 'template') throw new Error('kind');
    expect(job.components[2]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '1',
      parameters: [{ type: 'text', text: 'A-123' }],
    });
  });

  it('index fora do formato da Graph é recusado no consumo', () => {
    expect(() =>
      parseOutboundJob({
        kind: 'template',
        channelId: 'c',
        conversationId: 'v',
        messageId: 'm',
        chatId: '5511',
        templateName: 'pedido',
        languageCode: 'pt_BR',
        components: [{ type: 'button', sub_type: 'url', index: 'um', parameters: [] }],
      }),
    ).toThrow();
  });
});

describe('portão do modelo', () => {
  it('catálogo: só APPROVED disponível libera; ausente não bloqueia (campanha legada)', () => {
    expect(catalogBlockReason(null)).toBeNull();
    expect(catalogBlockReason({ status: 'APPROVED', isAvailable: true })).toBeNull();
    expect(catalogBlockReason({ status: 'approved', isAvailable: false })).toBe(
      'template_unavailable',
    );
    expect(catalogBlockReason({ status: 'PAUSED', isAvailable: true })).toBe('template_paused');
    expect(catalogBlockReason({ status: 'DISABLED', isAvailable: true })).toBe('template_disabled');
    expect(catalogBlockReason({ status: 'REJECTED', isAvailable: true })).toBe('template_rejected');
    expect(catalogBlockReason({ status: 'PENDING', isAvailable: true })).toBe(
      'template_unavailable',
    );
  });

  it('recusa da Meta: códigos do MODELO pausam; do contato não', () => {
    expect(templateFailureReason('WA_132015')).toBe('template_paused');
    expect(templateFailureReason('WA_132016')).toBe('template_disabled');
    expect(templateFailureReason('WA_132001')).toBe('template_unavailable');
    expect(templateFailureReason('WA_132000')).toBe('template_variables_mismatch');
    expect(templateFailureReason('WA_131026')).toBeNull();
    expect(templateFailureReason('consent_no_consent')).toBeNull();
    expect(templateFailureReason(undefined)).toBeNull();
  });
});
