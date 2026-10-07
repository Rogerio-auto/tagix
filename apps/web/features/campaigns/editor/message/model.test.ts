import { describe, expect, it } from 'vitest';
import { APPROVED, MEDIA, PLAIN, PLAIN_EN, RICH } from './fixtures';
import {
  addMessage,
  attachResolvedTemplates,
  bindingsForRequest,
  bindingsForTemplate,
  blankMessage,
  changeSourceKind,
  decodeStoredBindings,
  delayToSeconds,
  describeDelay,
  emptyMessageStep,
  facetValues,
  filterTemplates,
  fromStoredSteps,
  MAX_SEQUENCE_MESSAGES,
  moveMessage,
  parseTemplate,
  removeMessage,
  resolveButtonUrl,
  resolveTemplate,
  secondsToDelay,
  segmentText,
  selectTemplate,
  styleRuns,
  toStepsPayload,
  updateBinding,
  validateMessages,
  variableSlots,
  type ContactSample,
  type MessageDraft,
  type MessageStepValue,
  type TemplateBinding,
} from './model';

const ANA: ContactSample = {
  displayName: 'Ana Souza',
  phone: '+5511988887777',
  email: null,
  customFields: { cidade: 'Campinas', pontos: 120 },
};

function parsed(template = RICH) {
  const result = parseTemplate(template.components);
  if (!result) throw new Error('fixture inválida');
  return result;
}

function step(...messages: MessageDraft[]): MessageStepValue {
  return { messages, stopOnReply: true };
}

/** Rascunho com o RICH escolhido e todos os campos completos. */
function completeRich(key = 'a'): MessageDraft {
  let draft = selectTemplate(blankMessage(key), RICH);
  draft = updateBinding(draft, 'header:1', { kind: 'fixed', value: '#2026' });
  draft = updateBinding(draft, 'body:1', {
    kind: 'contact',
    field: 'displayName',
    fallback: 'cliente',
  });
  draft = updateBinding(draft, 'body:2', {
    kind: 'customField',
    key: 'prazo',
    fallback: 'poucos dias',
  });
  draft = updateBinding(draft, 'button:2', { kind: 'fixed', value: 'abc' });
  return draft;
}

const ready = { approved: APPROVED, catalogReady: true } as const;

describe('parseTemplate', () => {
  it('lê cabeçalho de texto, corpo, rodapé, exemplos e botões com posição 1-based', () => {
    const p = parsed();
    expect(p.header).toEqual({ format: 'TEXT', text: 'Pedido {{1}}', examples: ['PED-7'] });
    expect(p.body).toBe('Olá {{1}}, seu pedido chega em {{2}}.');
    expect(p.bodyExamples).toEqual(['Ana', '3 dias']);
    expect(p.footer).toBe('Loja Exemplo');
    expect(p.buttons.map((b) => [b.position, b.kind, b.hasVariable])).toEqual([
      [1, 'QUICK_REPLY', false],
      [2, 'URL', true],
    ]);
  });

  it('reconhece mídia no cabeçalho e botão de telefone', () => {
    const p = parsed(MEDIA);
    expect(p.header?.format).toBe('IMAGE');
    expect(p.buttons[0]).toMatchObject({ kind: 'PHONE_NUMBER', phone: '+5511999990000' });
  });

  it('devolve null para formato irreconhecível (nunca "vazio")', () => {
    expect(parseTemplate({ not: 'array' })).toBeNull();
    expect(parseTemplate(null)).toBeNull();
  });
});

describe('variableSlots', () => {
  it('modelo sem variável não pede nada', () => {
    expect(variableSlots(parsed(PLAIN))).toEqual([]);
  });

  it('lista título, corpo e link de botão na ordem em que aparecem', () => {
    const slots = variableSlots(parsed());
    expect(slots.map((s) => s.key)).toEqual(['header:1', 'body:1', 'body:2', 'button:2']);
    expect(slots[0]?.label).toBe('Título');
    expect(slots[1]?.approvedExample).toBe('Ana');
    expect(slots[3]?.label).toBe('Link do botão “Ver pedido”');
    expect(slots[2]?.context).toContain('{{2}}');
  });

  it('cabeçalho de mídia não vira campo de texto', () => {
    expect(variableSlots(parsed(MEDIA)).map((s) => s.key)).toEqual(['body:1']);
  });
});

describe('bindingsForTemplate', () => {
  it('sugere o nome do contato no primeiro espaço do texto, sem inventar texto reserva', () => {
    const bindings = bindingsForTemplate(parsed(), []);
    expect(bindings.find((b) => b.component === 'body' && b.index === 1)?.source).toEqual({
      kind: 'contact',
      field: 'displayName',
      fallback: '',
    });
    // O exemplo aprovado ("Ana") NUNCA é preenchido sozinho.
    expect(bindings.find((b) => b.component === 'body' && b.index === 2)?.source).toEqual({
      kind: 'fixed',
      value: '',
    });
  });

  it('preserva o que já estava mapeado no mesmo espaço ao trocar de modelo', () => {
    const previous: TemplateBinding[] = [
      { component: 'body', index: 1, source: { kind: 'fixed', value: 'Oi' } },
    ];
    expect(bindingsForTemplate(parsed(MEDIA), previous)).toEqual(previous);
  });
});

describe('validateMessages', () => {
  it('modelo sem variável escolhido: etapa pronta', () => {
    const value = step(selectTemplate(blankMessage('a'), PLAIN));
    expect(validateMessages(value, { mode: 'single', ...ready })).toEqual([]);
  });

  it('sem modelo: pede para escolher', () => {
    const issues = validateMessages(emptyMessageStep(), { mode: 'single', ...ready });
    expect(issues.map((i) => i.code)).toEqual(['template_missing']);
  });

  it('variável ausente, texto fixo vazio e texto reserva vazio aparecem todos de uma vez', () => {
    const draft = selectTemplate(blankMessage('a'), RICH);
    const codes = validateMessages(step(draft), { mode: 'single', ...ready }).map((i) => [
      i.code,
      i.slot,
    ]);
    expect(codes).toEqual([
      ['fixed_empty', 'header:1'],
      ['fallback_empty', 'body:1'],
      ['fixed_empty', 'body:2'],
      ['fixed_empty', 'button:2'],
    ]);
  });

  it('espaço sem mapeamento nenhum (step legado) vira variable_missing', () => {
    const draft: MessageDraft = { ...selectTemplate(blankMessage('a'), MEDIA), bindings: [] };
    const issues = validateMessages(step(draft), { mode: 'single', ...ready });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'variable_missing', slot: 'body:1' });
  });

  it('campo personalizado exige nome do campo e texto reserva', () => {
    let draft = selectTemplate(blankMessage('a'), MEDIA);
    draft = updateBinding(draft, 'body:1', { kind: 'customField', key: ' ', fallback: '' });
    const codes = validateMessages(step(draft), { mode: 'single', ...ready }).map((i) => i.code);
    expect(codes).toEqual(['custom_key_empty', 'fallback_empty']);
  });

  it('tudo preenchido: sem pendências', () => {
    expect(validateMessages(step(completeRich()), { mode: 'single', ...ready })).toEqual([]);
  });

  it('modelo pausado/rejeitado depois da seleção bloqueia e orienta', () => {
    const draft = completeRich();
    const withoutRich = APPROVED.filter((t) => t.id !== RICH.id);
    const issues = validateMessages(step(draft), {
      mode: 'single',
      approved: withoutRich,
      catalogReady: true,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('template_unavailable');
    expect(issues[0]?.text).toMatch(/Escolha outro ou sincronize/u);
  });

  it('catálogo carregando não acusa o modelo de ter sumido — mas também não libera', () => {
    const draft: MessageDraft = { ...completeRich(), templateId: null };
    const issues = validateMessages(step(draft), {
      mode: 'single',
      approved: [],
      catalogReady: false,
    });
    expect(issues[0]?.code).toBe('template_unavailable');
    expect(issues[0]?.text).toMatch(/Conferindo/u);
  });

  it('sequência precisa de duas mensagens e de espera entre 1 minuto e 90 dias', () => {
    const one = step(completeRich('a'));
    expect(validateMessages(one, { mode: 'sequence', ...ready }).map((i) => i.code)).toEqual([
      'sequence_too_short',
    ]);
    const second = { ...completeRich('b'), delay: { amount: 0, unit: 'days' as const } };
    const tooLong = { ...completeRich('c'), delay: { amount: 91, unit: 'days' as const } };
    const codes = validateMessages(step(completeRich('a'), second, tooLong), {
      mode: 'sequence',
      ...ready,
    }).map((i) => [i.code, i.messageKey]);
    expect(codes).toEqual([
      ['delay_invalid', 'b'],
      ['delay_invalid', 'c'],
    ]);
  });

  it('envio único ignora mensagens extras de quando era sequência', () => {
    const value = step(completeRich('a'), blankMessage('b'));
    expect(validateMessages(value, { mode: 'single', ...ready })).toEqual([]);
  });
});

describe('múltiplos idiomas', () => {
  it('rascunho do servidor casa por nome + idioma, não só pelo nome', () => {
    const draft: MessageDraft = {
      ...blankMessage('a'),
      templateName: 'aviso_loja_aberta',
      languageCode: 'en_US',
    };
    expect(resolveTemplate(draft, APPROVED)?.id).toBe(PLAIN_EN.id);
    expect(resolveTemplate({ ...draft, languageCode: 'es' }, APPROVED)).toBeNull();
  });

  it('filtro de idioma e facetas só oferecem o que existe', () => {
    expect(facetValues(APPROVED, 'language')).toEqual(['en_US', 'pt_BR']);
    expect(facetValues(APPROVED, 'category')).toEqual(['MARKETING', 'UTILITY']);
    const en = filterTemplates(APPROVED, { search: '', category: '', language: 'en_US' });
    expect(en.map((t) => t.id)).toEqual([PLAIN_EN.id]);
  });

  it('busca pelo texto da mensagem, sem acento e sem caixa', () => {
    const found = filterTemplates(APPROVED, {
      search: 'PROMOCAO marco',
      category: '',
      language: '',
    });
    expect(found.map((t) => t.id)).toEqual([MEDIA.id]);
    const byCategory = filterTemplates(APPROVED, { search: '', category: 'UTILITY', language: '' });
    expect(byCategory.map((t) => t.id)).toEqual([PLAIN.id, PLAIN_EN.id]);
  });
});

describe('prévia', () => {
  const bindings = completeRich().bindings;

  it('usa o dado real do contato e marca texto reserva quando ele falta', () => {
    const segments = segmentText(parsed().body, 'body', bindings, ANA);
    expect(segments).toEqual([
      { kind: 'text', text: 'Olá ' },
      { kind: 'variable', key: 'body:1', text: 'Ana Souza', missing: false, usedFallback: false },
      { kind: 'text', text: ', seu pedido chega em ' },
      { kind: 'variable', key: 'body:2', text: 'poucos dias', missing: false, usedFallback: true },
      { kind: 'text', text: '.' },
    ]);
  });

  it('variável ausente aparece como buraco visível, nunca some', () => {
    const segments = segmentText(parsed().body, 'body', [], null);
    expect(segments[1]).toEqual({
      kind: 'variable',
      key: 'body:1',
      text: '{{1}}',
      missing: true,
      usedFallback: false,
    });
  });

  it('campo personalizado numérico vira texto', () => {
    const custom: TemplateBinding[] = [
      {
        component: 'body',
        index: 1,
        source: { kind: 'customField', key: 'pontos', fallback: '0' },
      },
    ];
    const segments = segmentText('Você tem {{1}} pontos', 'body', custom, ANA);
    expect(segments[1]).toMatchObject({ text: '120', usedFallback: false });
  });

  it('link do botão recebe o final configurado', () => {
    const button = parsed().buttons[1];
    if (!button) throw new Error('fixture');
    expect(resolveButtonUrl(button, bindings, ANA)).toBe('https://loja.exemplo/p/abc');
    expect(resolveButtonUrl(button, [], ANA)).toBe('https://loja.exemplo/p/…');
  });

  it('formatação do WhatsApp vira estilos, sem aninhar', () => {
    expect(styleRuns('Olá *mundo* e _você_ ~não~ ```code```')).toEqual([
      { style: 'plain', text: 'Olá ' },
      { style: 'bold', text: 'mundo' },
      { style: 'plain', text: ' e ' },
      { style: 'italic', text: 'você' },
      { style: 'plain', text: ' ' },
      { style: 'strike', text: 'não' },
      { style: 'plain', text: ' ' },
      { style: 'mono', text: 'code' },
    ]);
  });
});

describe('espera em linguagem humana', () => {
  it('converte nos dois sentidos pela maior unidade exata', () => {
    expect(delayToSeconds({ amount: 2, unit: 'days' })).toBe(172_800);
    expect(secondsToDelay(172_800)).toEqual({ amount: 2, unit: 'days' });
    expect(secondsToDelay(5_400)).toEqual({ amount: 90, unit: 'minutes' });
    expect(secondsToDelay(7_200)).toEqual({ amount: 2, unit: 'hours' });
  });

  it('descreve com singular e plural', () => {
    expect(describeDelay({ amount: 1, unit: 'days' })).toBe('1 dia depois da mensagem anterior');
    expect(describeDelay({ amount: 3, unit: 'hours' })).toBe('3 horas depois da mensagem anterior');
  });
});

describe('sequência: adicionar, remover, reordenar', () => {
  it('adiciona até o limite e nunca remove a última', () => {
    let value = emptyMessageStep();
    for (let i = 0; i < MAX_SEQUENCE_MESSAGES + 3; i += 1) value = addMessage(value);
    expect(value.messages).toHaveLength(MAX_SEQUENCE_MESSAGES);
    const only = emptyMessageStep();
    const key = only.messages[0]?.key ?? '';
    expect(removeMessage(only, key)).toBe(only);
  });

  it('move uma posição e ignora movimento para fora da lista', () => {
    const value = step(blankMessage('a'), blankMessage('b'), blankMessage('c'));
    expect(moveMessage(value, 'c', -1).messages.map((m) => m.key)).toEqual(['a', 'c', 'b']);
    expect(moveMessage(value, 'a', -1)).toBe(value);
    expect(moveMessage(value, 'c', 1)).toBe(value);
  });
});

describe('contrato com a API', () => {
  it('envio único manda só a primeira mensagem, com espera zero', () => {
    const value = step(
      { ...completeRich('a'), delay: { amount: 3, unit: 'days' } },
      completeRich('b'),
    );
    const payload = toStepsPayload(value, 'single', APPROVED);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      position: 0,
      templateName: 'pedido_confirmado',
      languageCode: 'pt_BR',
      delaySeconds: 0,
      stopOnReply: true,
    });
  });

  it('sequência traduz a espera e o "parar se responder"', () => {
    const value: MessageStepValue = {
      messages: [completeRich('a'), { ...completeRich('b'), delay: { amount: 2, unit: 'days' } }],
      stopOnReply: false,
    };
    const payload = toStepsPayload(value, 'sequence', APPROVED);
    expect(payload.map((p) => [p.position, p.delaySeconds, p.stopOnReply])).toEqual([
      [0, 0, false],
      [1, 172_800, false],
    ]);
  });

  it('apara textos e descarta variáveis que o modelo não usa mais', () => {
    let draft = completeRich();
    draft = updateBinding(draft, 'body:1', {
      kind: 'contact',
      field: 'displayName',
      fallback: '  cliente  ',
    });
    draft = {
      ...draft,
      bindings: [
        ...draft.bindings,
        { component: 'body', index: 9, source: { kind: 'fixed', value: 'x' } },
      ],
    };
    const [only] = toStepsPayload(step(draft), 'single', APPROVED);
    expect(only?.bindings.map((b) => `${b.component}:${b.index}`)).toEqual([
      'body:1',
      'body:2',
      'button:2',
      'header:1',
    ]);
    expect(only?.bindings[0]?.source).toEqual({
      kind: 'contact',
      field: 'displayName',
      fallback: 'cliente',
    });
    expect(bindingsForRequest(draft, RICH)).toHaveLength(4);
  });

  it('hidrata o envelope binding_contract/v1 e ignora componentes Graph legados', () => {
    const [stored] = toStepsPayload(step(completeRich()), 'single', APPROVED);
    const envelope = [{ type: 'binding_contract', version: 1, bindings: stored?.bindings }];
    expect(decodeStoredBindings(envelope)).toEqual(stored?.bindings);
    expect(decodeStoredBindings([{ type: 'body', parameters: [] }])).toEqual([]);
    expect(decodeStoredBindings(null)).toEqual([]);

    const value = fromStoredSteps([
      {
        position: 1,
        templateName: 'aviso_loja_aberta',
        languageCode: 'pt_BR',
        templateComponents: [],
        delaySeconds: 3_600,
        stopOnReply: true,
      },
      {
        position: 0,
        templateName: 'pedido_confirmado',
        languageCode: 'pt_BR',
        templateComponents: envelope,
        delaySeconds: 0,
        stopOnReply: true,
      },
    ]);
    expect(value.messages.map((m) => m.templateName)).toEqual([
      'pedido_confirmado',
      'aviso_loja_aberta',
    ]);
    expect(value.messages[1]?.delay).toEqual({ amount: 1, unit: 'hours' });

    // O catálogo amarra o id sem mexer no que foi mapeado; sem mudança, mesmo objeto.
    const attached = attachResolvedTemplates(value, APPROVED);
    expect(attached.messages.map((m) => m.templateId)).toEqual([RICH.id, PLAIN.id]);
    // Mesmo conjunto mapeado (a ordem segue a do modelo, não a do servidor).
    expect(attached.messages[0]?.bindings).toHaveLength(stored?.bindings.length ?? -1);
    expect(attached.messages[0]?.bindings).toEqual(expect.arrayContaining(stored?.bindings ?? []));
    expect(attachResolvedTemplates(attached, APPROVED)).toBe(attached);
  });

  it('trocar a origem preserva o texto reserva entre fontes dinâmicas', () => {
    const contact = { kind: 'contact', field: 'email', fallback: 'seu e-mail' } as const;
    expect(changeSourceKind(contact, 'customField')).toEqual({
      kind: 'customField',
      key: '',
      fallback: 'seu e-mail',
    });
    expect(changeSourceKind(contact, 'fixed')).toEqual({ kind: 'fixed', value: '' });
  });
});
