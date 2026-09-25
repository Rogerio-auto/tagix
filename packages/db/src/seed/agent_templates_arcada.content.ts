/**
 * Conteúdo do agente de atendimento da Arcada (F70-S06) — PURO, sem I/O.
 *
 * Fonte única do que o agente pode afirmar: oferta (3 níveis), limites de
 * negociação aprovados em 24/09, gatilhos de handoff, base de conhecimento e
 * textos da cadência. O seed (`agent_templates_arcada.ts`) só persiste o que sai
 * daqui; os testes (`agent_templates_arcada.test.ts`) travam os limites.
 *
 * Regra de conteúdo: nada é inventado. Tudo que o Rogério ainda precisa informar
 * (o que cada nível inclui, portfólio, casos, meios de pagamento, como agendar,
 * nomes dos modelos aprovados na Meta) fica como marcador `{{marcador}}` e é
 * listado por `listPendingMarkers()`. O prompt instrui o agente a nunca expor um
 * marcador ao cliente.
 *
 * Valores (preços, parcelas, descontos) são DERIVADOS das constantes abaixo, nunca
 * digitados à mão no texto: mudar um limite muda o prompt inteiro de forma coerente,
 * e o teste garante que nenhum número fora dos limites aparece.
 */

/** Etiquetas usadas pelos flows e pelo agente. Nomes são contrato com os flows. */
export const ARCADA_TAGS = {
  /** A IA já foi decidida para este contato (ligada uma vez). Trava de reativação. */
  aiActivated: { name: 'ia-arcada', color: '#13C7FF' },
  /** Humano assumiu: a cadência para de mandar lembretes. */
  humanTakeover: { name: 'atendimento-humano', color: '#FFB020' },
  /** Sem resposta depois do 7º dia. Sai quando o contato volta a responder. */
  cooledDown: { name: 'esfriou', color: '#8A8F98' },
} as const;

export type ArcadaTagKey = keyof typeof ARCADA_TAGS;

/** Slug OpenRouter do modelo (whitelist do Leadium: `llm_models_whitelist`). */
export const ARCADA_MODEL = 'anthropic/claude-sonnet-4';

/**
 * Parâmetros do modelo. `max_tokens` limita o custo por TURNO (o runtime ainda
 * clampa pelo `max_tokens_per_call` da policy). O schema não tem teto de custo por
 * CONVERSA — ver `## Decisões` do slot.
 */
export const ARCADA_MODEL_PARAMS: Readonly<Record<string, unknown>> = {
  temperature: 0.4,
  max_tokens: 600,
};

/** Níveis da oferta, em reais inteiros. Aprovados pelo Rogério (slot F70-S06). */
export const ARCADA_TIERS = [
  { priceBrl: 1000, includesMarker: 'nivel_1000_inclui' },
  { priceBrl: 2500, includesMarker: 'nivel_2500_inclui' },
  { priceBrl: 5000, includesMarker: 'nivel_5000_inclui' },
] as const;

/** Limites de negociação aprovados em 24/09. Nunca ultrapassáveis pelo agente. */
export const ARCADA_NEGOTIATION_LIMITS = {
  /** Parcelamento oferecido de saída, sem juros. */
  defaultInstallments: 2,
  /** Máximo de parcelas, só se o cliente insistir. Sem juros. */
  maxInstallments: 3,
  /** Parcelado nunca tem desconto. */
  installmentsDiscountPct: 0,
  /** Desconto à vista oferecido, em qualquer nível. */
  cashDiscountPct: 10,
  /** Teto absoluto do desconto à vista. */
  maxCashDiscountPct: 15,
  /** Prazo de entrega comprometido. */
  deliveryBusinessDays: 5,
} as const;

/** Os 4 gatilhos de handoff para humano (`transfer_to_human`). */
export const ARCADA_HANDOFF_TRIGGERS = [
  {
    id: 'ready_to_close',
    title: 'Cliente pronto para fechar',
    when: 'disse que quer fechar, pediu contrato, dados para pagamento, nota fiscal ou perguntou como pagar.',
  },
  {
    id: 'asked_for_human',
    title: 'Pedido explícito de humano',
    when: 'pediu para falar com uma pessoa, com o Rogério ou com "alguém de verdade".',
  },
  {
    id: 'irritation',
    title: 'Irritação',
    when: 'demonstrou irritação, impaciência, reclamou do atendimento ou usou tom agressivo. Não argumente.',
  },
  {
    id: 'out_of_limits',
    title: 'Pedido fora dos limites',
    when: 'pediu qualquer coisa fora dos limites deste texto: desconto acima do teto, mais parcelas que o máximo, desconto no parcelado, prazo menor que o combinado, algo que não está descrito nos níveis, ou não é uma clínica. Também quando você não souber responder com segurança.',
  },
] as const;

export type ArcadaHandoffTriggerId = (typeof ARCADA_HANDOFF_TRIGGERS)[number]['id'];

// ─── Formatação monetária (pt-BR, determinística — sem depender de ICU/locale do SO).

/** Formata centavos como `R$ 1.234,56` (ou `R$ 1.234` quando inteiro). */
export function formatBrlCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`formatBrlCents: valor inválido (${cents})`);
  }
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  const reaisStr = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return rest === 0 ? `R$ ${reaisStr}` : `R$ ${reaisStr},${String(rest).padStart(2, '0')}`;
}

/** Valor à vista com desconto (em centavos, arredondado ao centavo). */
export function cashPriceCents(priceBrl: number, discountPct: number): number {
  return Math.round(priceBrl * 100 * (1 - discountPct / 100));
}

/**
 * Parcelas sem juros que somam exatamente o preço: as primeiras levam o valor
 * truncado, a última absorve o resto do centavo (R$ 1.000 em 3x = 333,33 + 333,33 + 333,34).
 */
export function installmentsCents(priceBrl: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`parcelas inválidas (${count})`);
  const total = priceBrl * 100;
  const base = Math.floor(total / count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = total - base * (count - 1);
  return parts;
}

function describeInstallments(priceBrl: number, count: number): string {
  const parts = installmentsCents(priceBrl, count);
  const first = parts[0] ?? 0;
  const last = parts[parts.length - 1] ?? 0;
  if (first === last) return `${count}x de ${formatBrlCents(first)}`;
  const head = parts.slice(0, -1).map(formatBrlCents).join(' + ');
  return `${count}x (${head} + ${formatBrlCents(last)})`;
}

/** Tabela de referência dos valores permitidos por nível (entra no prompt). */
export function negotiationReferenceLines(): string[] {
  const l = ARCADA_NEGOTIATION_LIMITS;
  return ARCADA_TIERS.map((t) => {
    const price = formatBrlCents(t.priceBrl * 100);
    const cash = formatBrlCents(cashPriceCents(t.priceBrl, l.cashDiscountPct));
    const cashMax = formatBrlCents(cashPriceCents(t.priceBrl, l.maxCashDiscountPct));
    return (
      `- ${price}: à vista com ${l.cashDiscountPct}% = ${cash}; teto com ${l.maxCashDiscountPct}% = ${cashMax}; ` +
      `${describeInstallments(t.priceBrl, l.defaultInstallments)}; ` +
      `se insistir, ${describeInstallments(t.priceBrl, l.maxInstallments)}.`
    );
  });
}

/** Todos os valores em centavos que o agente pode citar (usado pelo teste anti-invenção). */
export function allowedAmountsCents(): Set<number> {
  const l = ARCADA_NEGOTIATION_LIMITS;
  const out = new Set<number>();
  for (const t of ARCADA_TIERS) {
    out.add(t.priceBrl * 100);
    out.add(cashPriceCents(t.priceBrl, l.cashDiscountPct));
    out.add(cashPriceCents(t.priceBrl, l.maxCashDiscountPct));
    for (let n = l.defaultInstallments; n <= l.maxInstallments; n += 1) {
      for (const c of installmentsCents(t.priceBrl, n)) out.add(c);
    }
  }
  return out;
}

// ─── Prompt (versionado em `agent_prompt_versions`).

/** Marcador de conteúdo pendente, no formato que o prompt e o teste reconhecem. */
const m = (key: string): string => `{{${key}}}`;

/** Monta o system prompt do agente "Arcada — atendimento" (pt-BR). */
export function buildArcadaSystemPrompt(): string {
  const l = ARCADA_NEGOTIATION_LIMITS;
  const tiers = ARCADA_TIERS.map(
    (t) => `- ${formatBrlCents(t.priceBrl * 100)}: ${m(t.includesMarker)}`,
  );
  const triggers = ARCADA_HANDOFF_TRIGGERS.map(
    (t, i) => `${i + 1}. ${t.title} [${t.id}]: o cliente ${t.when}`,
  );

  return [
    'Você é o atendimento da Arcada no WhatsApp e no Instagram. A Arcada cria sites para clínicas.',
    'Quem decide e fecha é o Rogério. Seu papel: entender a clínica, tirar dúvidas, mostrar o portfólio, ajudar a agendar uma conversa e negociar somente dentro dos limites deste texto. Quando o cliente estiver pronto para fechar, você passa para o Rogério.',
    '',
    '## Como você conversa',
    '- Português do Brasil, tom consultivo e humano, de quem entende a rotina de uma clínica. Nada de linguagem de vendedor.',
    '- Mensagens curtas (de 1 a 3 frases) e uma pergunta por vez. Escute antes de oferecer.',
    '- Sem pressão: nunca use urgência ou escassez ("só hoje", "últimas vagas", "promoção acaba"). Se o cliente quiser pensar, respeite.',
    '- Emoji só se o cliente usar, e no máximo um.',
    '- Se perguntarem se você é uma pessoa, diga com naturalidade que é o assistente virtual da Arcada e que o Rogério acompanha as conversas.',
    '- Não invente nada. Se a resposta não estiver neste texto nem na base de conhecimento, diga que confirma com o Rogério.',
    '- Trechos entre chaves duplas (como {{exemplo}}) são informações ainda não preenchidas. Nunca mostre esses trechos ao cliente e nunca suponha o conteúdo deles: trate como "vou confirmar com o Rogério".',
    '',
    '## Oferta: três níveis de site para clínicas, preço fechado',
    ...tiers,
    `Prazo: entrega em até ${l.deliveryBusinessDays} dias úteis, contados a partir de ${m('inicio_do_prazo')}. Costuma ficar pronto antes, mas o compromisso é de até ${l.deliveryBusinessDays} dias úteis.`,
    'Recomende o nível a partir do que a clínica precisa, usando só a descrição de cada nível. Na dúvida, apresente os três e pergunte o que pesa mais para ela.',
    '',
    '## Qualificação (ao longo da conversa, nunca como formulário)',
    '1. É uma clínica? De qual especialidade?',
    '2. Já tem site hoje? Se tiver, peça o link.',
    '3. É quem decide? Se não for, pergunte quem mais participa da decisão.',
    '4. Para quando precisa do site?',
    'Se não for uma clínica, explique com respeito que o foco da Arcada é site para clínicas e passe para o Rogério.',
    '',
    '## Portfólio e casos',
    `- Envie o portfólio quando o cliente quiser ver trabalhos ou depois de entender a clínica: ${m('links_do_portfolio')}.`,
    `- Casos que você pode citar: ${m('casos_autorizados')}. Cite apenas o que estiver escrito ali; não mencione nenhum outro cliente.`,
    '',
    '## Agendamento',
    `Quando fizer sentido uma conversa com o Rogério (dúvida que você não resolve, cliente quer mostrar para um sócio, quer entender melhor antes de decidir): ${m('como_agendar')}.`,
    '',
    '## Negociação: limites aprovados (nunca ultrapasse)',
    `- Parcelamento: ofereça em até ${l.defaultInstallments}x sem juros. Só se o cliente insistir, pode chegar a ${l.maxInstallments}x sem juros. Nunca parcele em mais de ${l.maxInstallments} vezes.`,
    '- No parcelado não existe desconto.',
    `- À vista: ${l.cashDiscountPct}% de desconto em qualquer nível. Se o cliente continuar negociando o preço, você pode chegar a ${l.maxCashDiscountPct}%, uma única vez, e esse é o teto absoluto.`,
    '- Desconto e parcelamento nunca se combinam.',
    `- Meios de pagamento: ${m('meios_de_pagamento')}.`,
    `- Prazo: até ${l.deliveryBusinessDays} dias úteis. Não prometa prazo menor.`,
    '- Não prometa nada que não esteja neste texto ou na base de conhecimento: funcionalidades, domínio, hospedagem, manutenção, garantias, integrações, brindes ou condições especiais.',
    'Valores de referência (use exatamente estes):',
    ...negotiationReferenceLines(),
    '',
    '## Quando passar para o Rogério',
    'Chame a ferramenta transfer_to_human, com o motivo em uma frase, em QUALQUER um destes casos:',
    ...triggers,
    'Antes de transferir:',
    `- se a ferramenta de etiqueta estiver disponível, aplique a etiqueta "${ARCADA_TAGS.humanTakeover.name}" no contato;`,
    '- avise o cliente em uma frase: "Vou chamar o Rogério para seguir com você por aqui.";',
    '- no motivo, resuma para o Rogério: o que a clínica precisa, o que já foi qualificado, o nível de interesse e a condição conversada.',
    'Depois de transferir, não responda mais. Se a ferramenta não estiver disponível ou falhar, mande a mesma frase de aviso e não negocie mais nada.',
  ].join('\n');
}

// ─── Base de conhecimento (kb_documents). Nasce em rascunho e invisível ao agente.

export interface ArcadaKbDocument {
  /** Âncora estável do id determinístico (nunca renomear). */
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly rawContent: string;
}

export function buildArcadaKbDocuments(): ArcadaKbDocument[] {
  const l = ARCADA_NEGOTIATION_LIMITS;
  const tierSections = ARCADA_TIERS.map((t) =>
    [
      `## Site de ${formatBrlCents(t.priceBrl * 100)}`,
      '',
      `O que inclui: ${m(t.includesMarker)}`,
    ].join('\n'),
  );

  return [
    {
      key: 'niveis',
      title: 'Arcada — níveis de site para clínicas',
      category: 'Oferta',
      tags: ['arcada', 'oferta', 'precos'],
      rawContent: [
        '# Níveis de site da Arcada',
        '',
        'A Arcada faz sites para clínicas em três níveis, com preço fechado.',
        '',
        ...tierSections.flatMap((s) => [s, '']),
        '## Condições',
        '',
        `- Parcelamento em até ${l.defaultInstallments}x sem juros; até ${l.maxInstallments}x sem juros se o cliente precisar. Parcelado não tem desconto.`,
        `- À vista: ${l.cashDiscountPct}% de desconto.`,
        `- Prazo de entrega: até ${l.deliveryBusinessDays} dias úteis, contados a partir de ${m('inicio_do_prazo')}.`,
        `- Meios de pagamento: ${m('meios_de_pagamento')}.`,
      ].join('\n'),
    },
    {
      key: 'faq',
      title: 'Arcada — perguntas frequentes',
      category: 'FAQ',
      tags: ['arcada', 'faq'],
      rawContent: [
        '# Perguntas frequentes',
        '',
        '## Quanto tempo leva para o site ficar pronto?',
        `Até ${l.deliveryBusinessDays} dias úteis, contados a partir de ${m('inicio_do_prazo')}. Normalmente fica pronto antes.`,
        '',
        '## Quais são as formas de pagamento?',
        `${m('meios_de_pagamento')}. Parcelamento em até ${l.defaultInstallments}x sem juros (até ${l.maxInstallments}x se precisar); à vista com ${l.cashDiscountPct}% de desconto.`,
        '',
        '## O que eu preciso enviar para começar?',
        m('material_necessario'),
        '',
        '## Domínio e hospedagem estão incluídos?',
        m('dominio_e_hospedagem'),
        '',
        '## Consigo pedir alterações depois que o site ficar pronto?',
        m('alteracoes_e_manutencao'),
        '',
        '## O site aparece no Google?',
        m('google_e_seo'),
        '',
        '## Tem contrato e nota fiscal?',
        m('contrato_e_nota_fiscal'),
      ].join('\n'),
    },
    {
      key: 'portfolio',
      title: 'Arcada — portfólio e casos',
      category: 'Portfólio',
      tags: ['arcada', 'portfolio', 'casos'],
      rawContent: [
        '# Portfólio e casos',
        '',
        '## Portfólio',
        m('links_do_portfolio'),
        '',
        '## Casos que podem ser citados',
        `${m('casos_autorizados')}`,
        '',
        'Só cite clientes listados aqui, com as informações escritas aqui.',
      ].join('\n'),
    },
  ];
}

// ─── Cadência sem resposta (flow). Textos livres só dentro da janela de 24h.

export const ARCADA_CADENCE = {
  /** Lembrete livre, ainda dentro da janela de 24h do WhatsApp (conta da última msg do cliente). */
  reminderWithin24hMinutes: 20 * 60,
  /** 3º dia desde a última mensagem do cliente (modelo aprovado — fora da janela). */
  day3Minutes: 3 * 24 * 60,
  /** 7º dia desde a última mensagem do cliente (modelo aprovado) + etiqueta `esfriou`. */
  day7Minutes: 7 * 24 * 60,
  /** Toque 30 dias depois de marcar `esfriou`. */
  touchAfterCooledMinutes: 30 * 24 * 60,
  /** Texto sugerido do lembrete dentro de 24h (aguarda aprovação do Rogério). */
  reminderText:
    'Oi! Passando só para saber se ficou alguma dúvida sobre o site da clínica. Se quiser, seguimos por aqui mesmo.',
  /** Modelos aprovados na Meta (nome exato do template) — a preencher. */
  day3TemplateMarker: 'modelo_lembrete_dia_3',
  day7TemplateMarker: 'modelo_lembrete_dia_7',
  day30TemplateMarker: 'modelo_toque_30_dias',
  templateLanguage: 'pt_BR',
} as const;

export const marker = m;

const MARKER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Marcadores `{{…}}` presentes num texto (ordem de aparição, sem repetição). */
export function extractMarkers(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MARKER_RE)) {
    const key = match[1];
    if (key && key !== 'exemplo' && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Tudo que o Rogério ainda precisa preencher (prompt + KB + cadência). */
export function listPendingMarkers(): string[] {
  const texts = [
    buildArcadaSystemPrompt(),
    ...buildArcadaKbDocuments().map((d) => d.rawContent),
    m(ARCADA_CADENCE.day3TemplateMarker),
    m(ARCADA_CADENCE.day7TemplateMarker),
    m(ARCADA_CADENCE.day30TemplateMarker),
  ];
  const out: string[] = [];
  for (const t of texts) for (const k of extractMarkers(t)) if (!out.includes(k)) out.push(k);
  return out;
}
