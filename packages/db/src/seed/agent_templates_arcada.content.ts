/**
 * Conteúdo do agente de atendimento da Arcada (F70-S06, preço de lançamento F70-S33) — PURO, sem I/O.
 *
 * Fonte única do que o agente pode afirmar: oferta (3 níveis com preço de lançamento),
 * pagamento por nível, prazo, gatilhos de handoff, base de conhecimento e textos da
 * cadência. O seed (`agent_templates_arcada.ts`) só persiste o que sai daqui; os testes
 * (`agent_templates_arcada.test.ts`) travam preços, parcelas, prazo e a ausência de
 * qualquer oferta de desconto, urgência ou escassez.
 *
 * Regra de conteúdo: nada é inventado. O que cada nível inclui foi transcrito de
 * `rogerio-os/vault/04-projetos/arcada.md` (prevalece) e de
 * `portfolio-sites/planejamento/niveis-odonto/PLANO.md` (detalhe), e está PRÉ-PREENCHIDO
 * para aprovação do Rogério (entra como rascunho de versão). O que essas fontes não dizem
 * continua como marcador `{{marcador}}`, listado por `listPendingMarkers()`. O prompt
 * instrui o agente a nunca expor um marcador ao cliente.
 *
 * Valores (preço, parcelas) são DERIVADOS das constantes abaixo, nunca digitados à mão
 * no texto: mudar um preço muda o prompt inteiro de forma coerente, e o teste garante que
 * nenhum valor fora da tabela aparece.
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
export const ARCADA_MODEL = 'anthropic/claude-sonnet-5';

/**
 * Parâmetros do modelo. `max_tokens` limita o custo por TURNO (o runtime ainda
 * clampa pelo `max_tokens_per_call` da policy). O schema não tem teto de custo por
 * CONVERSA — ver `## Decisões` do slot.
 */
export const ARCADA_MODEL_PARAMS: Readonly<Record<string, unknown>> = {
  temperature: 0.4,
  max_tokens: 600,
};

/**
 * Níveis da oferta com o PREÇO DE LANÇAMENTO (Rogério, 29/09/2026), em reais inteiros.
 * `maxInstallments`: 1 = só à vista; o Cinema divide em até 2 parcelas iguais.
 * Nunca há desconto (nem à vista, nem negociando).
 */
export const ARCADA_TIERS = [
  {
    key: 'essencial',
    name: 'Essencial',
    priceBrl: 297,
    maxInstallments: 1,
    includesMarker: 'nivel_essencial_inclui',
    demo: 'Aline Tenório Odontologia',
  },
  {
    key: 'estudio',
    name: 'Estúdio',
    priceBrl: 397,
    maxInstallments: 1,
    includesMarker: 'nivel_estudio_inclui',
    demo: 'Quadrante Odontologia',
  },
  {
    key: 'cinema',
    name: 'Cinema',
    priceBrl: 999,
    maxInstallments: 2,
    includesMarker: 'nivel_cinema_inclui',
    demo: 'Nácar Odontologia',
  },
] as const;

export type ArcadaTier = (typeof ARCADA_TIERS)[number];
export type ArcadaTierKey = ArcadaTier['key'];

/** Regras comerciais de 29/09 (substituem os limites de 24/09). */
export const ARCADA_NEGOTIATION_LIMITS = {
  /** Nenhum desconto, em nenhum nível, em nenhuma circunstância. */
  discountAllowed: false,
  /** Entrega final em todos os níveis. Nunca prometer menos. */
  deliveryBusinessDays: 5,
} as const;

/** Frase única do posicionamento do preço (prompt e KB). Nada de prazo para a condição. */
export const ARCADA_LAUNCH_PRICE_PHRASE =
  'valor de lançamento, enquanto a Arcada monta os primeiros casos';

/**
 * A ÚNICA forma em que a palavra "desconto" pode aparecer no texto gerado: a negação.
 * O teste conta as ocorrências de "descont…" e exige que todas sejam esta.
 */
export const ARCADA_NO_DISCOUNT = 'não tem desconto';

/** Início do prazo (pré-preenchido para aprovação; `PLANO.md` §5 etapa 2 e §7). */
export const ARCADA_DEADLINE_START =
  'recebimento do material completo, com o CRO do responsável técnico';

/** Compromisso de prazo, idêntico em todos os níveis, no prompt e na KB. */
export const ARCADA_DELIVERY_COMMITMENT = `até ${ARCADA_NEGOTIATION_LIMITS.deliveryBusinessDays} dias úteis, contados a partir do ${ARCADA_DEADLINE_START}`;

/**
 * Regra de tom contra pressão. É o ÚNICO trecho que pode citar expressões de urgência e
 * escassez (como exemplos do que é proibido); o teste remove esta frase exata antes de
 * varrer o texto.
 */
export const ARCADA_NO_PRESSURE_RULE =
  '- Sem pressão: nunca use urgência ou escassez ("só hoje", "últimas vagas", "promoção acaba", "por tempo limitado"). O valor de lançamento não tem data para acabar: nunca invente prazo para ele. Se o cliente quiser pensar, respeite.';

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
    when: `pediu qualquer coisa fora deste texto: insistiu em baixar o preço depois de ouvir que é o valor de lançamento e ${ARCADA_NO_DISCOUNT}, pediu parcelamento fora do permitido (Essencial e Estúdio só à vista; Cinema em no máximo 2 parcelas), prazo menor que o combinado, algo que não está descrito nos níveis, ou não é uma clínica. Também quando você não souber responder com segurança.`,
  },
] as const;

export type ArcadaHandoffTriggerId = (typeof ARCADA_HANDOFF_TRIGGERS)[number]['id'];

// ─── O que cada nível inclui — PRÉ-PREENCHIDO para aprovação (F70-S33).
//
// Fonte: `arcada.md` (tabela "Níveis", prevalece) + `niveis-odonto/PLANO.md` §1 (detalhe
// do Essencial e do Estúdio; o Cinema é "Estúdio + camada de movimento"). Divergências
// registradas no slot F70-S33.

export interface ArcadaTierIncludes {
  /** Para quem o nível foi pensado (`arcada.md`, linha "Para quem"). */
  readonly forWhom: string;
  /** O que o nível entrega, item a item. */
  readonly items: readonly string[];
}

export const ARCADA_TIER_INCLUDES: Readonly<Record<ArcadaTierKey, ArcadaTierIncludes>> = {
  essencial: {
    forWhom: 'dentista que atende sozinho (ou em dupla) e hoje tem só Instagram ou Linktree',
    items: [
      '1 página longa, mais política de privacidade e página 404',
      'até 6 tratamentos, cada um num bloco próprio da página',
      'responsável técnico em destaque (mais 1 colega), com nome e CRO',
      'design no sistema visual da Arcada, na direção escolhida e ajustada à marca da clínica',
      'fotos do próprio cliente, feitas no celular, com guia de fotografia e tratamento de imagem da Arcada',
      'textos da biblioteca da Arcada, adaptados à clínica e aprovados pelo dentista',
      'até 6 avaliações do Google, reproduzidas como foram publicadas, com link para a ficha',
      'medição sem cookie, com contagem de cliques no WhatsApp',
      'SEO local: negócio local e perguntas frequentes em dados estruturados, com Search Console',
      'ficha do Google revisada: categoria, link, horários e fotos',
      '2 rodadas de revisão',
      '30 dias de ajustes depois da entrega',
    ],
  },
  estudio: {
    forWhom: 'clínica com 2 ou mais dentistas e tratamentos de ticket alto',
    items: [
      '10 a 16 páginas',
      'até 8 tratamentos, cada um com página própria',
      'página do corpo clínico, com perfil de cada dentista e o CRO de cada um',
      'design feito do zero, a partir da marca e das fotos reais da clínica',
      'roteiro de fotos e sessão de fotos guiada por vídeo (sem fotógrafo)',
      'textos escritos por tratamento, a partir de uma entrevista de 30 minutos, aprovados pelo dentista',
      'até 12 avaliações do Google, reproduzidas como foram publicadas, filtráveis por tratamento',
      'medição com GA4, Meta Pixel e API de Conversões, com banner de consentimento',
      'SEO: tudo do Essencial, mais dados estruturados por tratamento, sitemap por página e 3 artigos iniciais',
      'ficha do Google revisada, mais um plano de 4 semanas de postagens na ficha',
      '3 rodadas de revisão',
      '30 dias de ajustes depois da entrega e relatório de 30 dias',
    ],
  },
  cinema: {
    forWhom: 'clínica que quer ser a referência visual da cidade',
    items: [
      'tudo do Estúdio',
      'mais a camada de movimento: cena de scroll gerada, vídeo no topo e movimento dirigido',
    ],
  },
};

/** Vale para todos os níveis (`arcada.md`: regra dos níveis, CFO e diferenciais declarados). */
export const ARCADA_ALL_TIERS_INCLUDE: readonly string[] = [
  'O nível muda o escopo, nunca a qualidade.',
  'Todo site passa pela verificação do Código de Ética Odontológica antes de ir ao ar.',
  'O site é entregue na estrutura da clínica e continua dela; não há mensalidade obrigatória.',
];

/** Site da Arcada (`arcada.md`, Status > Site). */
export const ARCADA_SITE_URL = 'https://arcada-sandy.vercel.app';

/** Nível pela chave (lança se não existir: chave é contrato do código). */
export function tierByKey(key: ArcadaTierKey): ArcadaTier {
  const found = ARCADA_TIERS.find((t) => t.key === key);
  if (!found) throw new Error(`Nível desconhecido: ${key}`);
  return found;
}

/** Descrição do que um nível inclui, como entra no prompt e na KB. */
export function tierIncludesText(tier: ArcadaTier): string {
  const inc = ARCADA_TIER_INCLUDES[tier.key];
  return `para ${inc.forWhom}. Inclui: ${inc.items.join('; ')}.`;
}

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

/**
 * Parcelas que somam exatamente o preço: as primeiras levam o valor truncado, a última
 * absorve o resto do centavo. O Cinema (R$ 999 em 2) divide em 2 × R$ 499,50 exatos.
 */
export function installmentsCents(priceBrl: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`parcelas inválidas (${count})`);
  const total = priceBrl * 100;
  const base = Math.floor(total / count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = total - base * (count - 1);
  return parts;
}

/** `2 × R$ 499,50` (parcelas iguais) ou `2 parcelas (R$ a + R$ b)` quando o centavo não fecha. */
export function describeInstallments(priceBrl: number, count: number): string {
  const parts = installmentsCents(priceBrl, count);
  const first = parts[0] ?? 0;
  const last = parts[parts.length - 1] ?? 0;
  if (first === last) return `${count} × ${formatBrlCents(first)}`;
  return `${count} parcelas (${parts.map(formatBrlCents).join(' + ')})`;
}

/** Como o nível pode ser pago (só à vista, ou à vista ou em N parcelas iguais). */
export function tierPaymentText(tier: ArcadaTier): string {
  if (tier.maxInstallments <= 1) return 'só à vista';
  return `à vista ou em ${tier.maxInstallments} parcelas iguais (${describeInstallments(tier.priceBrl, tier.maxInstallments)}), nunca mais que ${tier.maxInstallments}`;
}

/** Tabela de referência dos valores permitidos por nível (entra no prompt). */
export function negotiationReferenceLines(): string[] {
  return ARCADA_TIERS.map(
    (t) => `- ${t.name}, ${formatBrlCents(t.priceBrl * 100)}: ${tierPaymentText(t)}.`,
  );
}

/** Todos os valores em centavos que o agente pode citar (usado pelo teste anti-invenção). */
export function allowedAmountsCents(): Set<number> {
  const out = new Set<number>();
  for (const t of ARCADA_TIERS) {
    out.add(t.priceBrl * 100);
    if (t.maxInstallments > 1) {
      for (const c of installmentsCents(t.priceBrl, t.maxInstallments)) out.add(c);
    }
  }
  return out;
}

// ─── Prompt (versionado em `agent_prompt_versions`).

/** Marcador de conteúdo pendente, no formato que o prompt e o teste reconhecem. */
const m = (key: string): string => `{{${key}}}`;

/** Linhas do portfólio: site da Arcada + demos, sempre como projeto conceito. */
function portfolioLines(): string[] {
  return [
    `Site da Arcada: ${ARCADA_SITE_URL}`,
    ...ARCADA_TIERS.map(
      (t) => `${t.demo}: projeto conceito do nível ${t.name} (clínica fictícia, não é cliente).`,
    ),
    `Links dos projetos conceito: ${m('links_das_demos')}.`,
  ];
}

/** Monta o system prompt do agente "Arcada — atendimento" (pt-BR). */
export function buildArcadaSystemPrompt(): string {
  const tiers = ARCADA_TIERS.map(
    (t) => `- ${t.name}, ${formatBrlCents(t.priceBrl * 100)}: ${tierIncludesText(t)}`,
  );
  const triggers = ARCADA_HANDOFF_TRIGGERS.map(
    (t, i) => `${i + 1}. ${t.title} [${t.id}]: o cliente ${t.when}`,
  );

  return [
    'Você é o atendimento da Arcada no WhatsApp e no Instagram. A Arcada cria sites para clínicas odontológicas.',
    'Quem decide e fecha é o Rogério. Seu papel: entender a clínica, tirar dúvidas, mostrar o portfólio, ajudar a agendar uma conversa e explicar as condições deste texto, sem sair delas. Quando o cliente estiver pronto para fechar, você passa para o Rogério.',
    '',
    '## Como você conversa',
    '- Português do Brasil, tom consultivo e humano, de quem entende a rotina de uma clínica. Nada de linguagem de vendedor.',
    '- Mensagens curtas (de 1 a 3 frases) e uma pergunta por vez. Escute antes de oferecer.',
    ARCADA_NO_PRESSURE_RULE,
    '- Emoji só se o cliente usar, e no máximo um.',
    '- Se perguntarem se você é uma pessoa, diga com naturalidade que é o assistente virtual da Arcada e que o Rogério acompanha as conversas.',
    '- Não invente nada. Se a resposta não estiver neste texto nem na base de conhecimento, diga que confirma com o Rogério.',
    '- Trechos entre chaves duplas (como {{exemplo}}) são informações ainda não preenchidas. Nunca mostre esses trechos ao cliente e nunca suponha o conteúdo deles: trate como "vou confirmar com o Rogério".',
    '',
    '## Oferta: três níveis de site para clínicas, preço fechado',
    `Os preços abaixo são o ${ARCADA_LAUNCH_PRICE_PHRASE}.`,
    ...tiers,
    ...ARCADA_ALL_TIERS_INCLUDE.map(
      (s) => `- Em todos os níveis: ${s.charAt(0).toLowerCase()}${s.slice(1)}`,
    ),
    `Prazo, em todos os níveis: entrega final em ${ARCADA_DELIVERY_COMMITMENT}.`,
    'Recomende o nível a partir do que a clínica precisa, usando só a descrição de cada nível. Na dúvida, apresente os três e pergunte o que pesa mais para ela.',
    '',
    '## Qualificação (ao longo da conversa, nunca como formulário)',
    '1. É uma clínica? De qual especialidade?',
    '2. Já tem site hoje? Se tiver, peça o link.',
    '3. É quem decide? Se não for, pergunte quem mais participa da decisão.',
    '4. Para quando precisa do site?',
    'Se não for uma clínica, explique com respeito que o foco da Arcada é site para clínicas odontológicas e passe para o Rogério.',
    '',
    '## Portfólio e casos',
    '- Envie o portfólio quando o cliente quiser ver trabalhos ou depois de entender a clínica:',
    ...portfolioLines().map((l) => `  ${l}`),
    '- Os projetos conceito mostram cada nível, mas são clínicas fictícias: sempre diga que são projeto conceito e nunca os apresente como cliente ou caso real.',
    `- Casos de clientes que você pode citar: ${m('casos_autorizados')}. Cite apenas o que estiver escrito ali; não mencione nenhum outro cliente.`,
    '',
    '## Agendamento',
    `Quando fizer sentido uma conversa com o Rogério (dúvida que você não resolve, cliente quer mostrar para um sócio, quer entender melhor antes de decidir): ${m('como_agendar')}.`,
    '',
    '## Pagamento e prazo (nunca saia disto)',
    `- É o ${ARCADA_LAUNCH_PRICE_PHRASE}, com preço fechado: ${ARCADA_NO_DISCOUNT}, nem à vista, nem negociando, em nenhum nível.`,
    ...negotiationReferenceLines(),
    `- Se o cliente pedir para baixar o preço: explique, sem pressão, que é o ${ARCADA_LAUNCH_PRICE_PHRASE}, e que ${ARCADA_NO_DISCOUNT}. Se ele insistir, ou pedir uma forma de pagar diferente das de cima, passe para o Rogério [out_of_limits].`,
    `- Meios de pagamento: ${m('meios_de_pagamento')}.`,
    `- Prazo: ${ARCADA_DELIVERY_COMMITMENT}. Nunca prometa prazo menor.`,
    '- Não prometa nada que não esteja neste texto ou na base de conhecimento: funcionalidades, domínio, hospedagem, manutenção, garantias, integrações ou condições especiais.',
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
  const tierSections = ARCADA_TIERS.map((t) => {
    const inc = ARCADA_TIER_INCLUDES[t.key];
    return [
      `## ${t.name}: ${formatBrlCents(t.priceBrl * 100)}`,
      '',
      `Para quem: ${inc.forWhom}.`,
      '',
      'O que inclui:',
      ...inc.items.map((i) => `- ${i}`),
      '',
      // Cada linha nomeia o nível: o chunk indexado continua legível fora da seção.
      `Pagamento do ${t.name}: ${tierPaymentText(t)}.`,
      `Prazo do ${t.name}: entrega final em ${ARCADA_DELIVERY_COMMITMENT}.`,
      `Projeto conceito do ${t.name}: ${t.demo} (clínica fictícia, não é cliente).`,
    ].join('\n');
  });

  return [
    {
      key: 'niveis',
      title: 'Arcada — níveis de site para clínicas',
      category: 'Oferta',
      tags: ['arcada', 'oferta', 'precos'],
      rawContent: [
        '# Níveis de site da Arcada',
        '',
        'A Arcada faz sites para clínicas odontológicas em três níveis, com preço fechado.',
        `Os preços são o ${ARCADA_LAUNCH_PRICE_PHRASE}.`,
        '',
        ...tierSections.flatMap((s) => [s, '']),
        '## Em todos os níveis',
        '',
        ...ARCADA_ALL_TIERS_INCLUDE.map((s) => `- ${s}`),
        '',
        '## Condições',
        '',
        `- Preço fechado: ${ARCADA_NO_DISCOUNT}, nem à vista, nem negociando, em nenhum nível.`,
        ...negotiationReferenceLines(),
        `- Prazo de entrega final: ${ARCADA_DELIVERY_COMMITMENT}.`,
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
        `A entrega final é em ${ARCADA_DELIVERY_COMMITMENT}, em todos os níveis.`,
        '',
        '## Quais são as formas de pagamento?',
        `${m('meios_de_pagamento')}. Essencial e Estúdio: só à vista. Cinema: ${tierPaymentText(tierByKey('cinema'))}.`,
        '',
        '## Dá para fazer um preço melhor?',
        `Os preços já são o ${ARCADA_LAUNCH_PRICE_PHRASE}. O preço é fechado e ${ARCADA_NO_DISCOUNT}.`,
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
        ...portfolioLines().map((l) => `- ${l}`),
        '',
        'Os projetos conceito são clínicas fictícias, criadas para mostrar cada nível. Nunca são apresentados como cliente ou caso real.',
        '',
        '## Casos de clientes que podem ser citados',
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
  /**
   * Modelos da Meta (nomes definidos pelo Rogério em 29/09; aprovação na Meta pendente).
   * Envio SEM parâmetros (o node `template` não leva `params`).
   */
  day3TemplateName: 'arcada_lembrete_dia_3',
  day7TemplateName: 'arcada_lembrete_dia_7',
  day30TemplateName: 'arcada_toque_30_dias',
  templateLanguage: 'pt_BR',
} as const;

/**
 * Marcadores dos modelos na versão anterior do seed → nome definido. O seed troca no
 * flow de cadência em RASCUNHO só o `templateName` que ainda é o marcador (edição do
 * operador vence).
 */
export const ARCADA_LEGACY_TEMPLATE_MARKERS: Readonly<Record<string, string>> = {
  [m('modelo_lembrete_dia_3')]: ARCADA_CADENCE.day3TemplateName,
  [m('modelo_lembrete_dia_7')]: ARCADA_CADENCE.day7TemplateName,
  [m('modelo_toque_30_dias')]: ARCADA_CADENCE.day30TemplateName,
};

/**
 * Marcadores da versão anterior que agora estão PRÉ-PREENCHIDOS e aguardam a aprovação do
 * Rogério (publicando o rascunho). Chave = marcador; valor = de onde veio o conteúdo.
 */
export const ARCADA_PREFILLED_FOR_APPROVAL: Readonly<Record<string, string>> = {
  nivel_essencial_inclui: 'arcada.md (Níveis) + niveis-odonto/PLANO.md §1',
  nivel_estudio_inclui: 'arcada.md (Níveis) + niveis-odonto/PLANO.md §1',
  nivel_cinema_inclui: 'arcada.md (Níveis) + niveis-odonto/PLANO.md §1',
  inicio_do_prazo: 'niveis-odonto/PLANO.md §5 (etapa 2) e §7',
  links_do_portfolio: 'arcada.md (Status > Site; demos, projeto conceito)',
  modelo_lembrete_dia_3: 'Rogério, 29/09 (aprovação na Meta pendente)',
  modelo_lembrete_dia_7: 'Rogério, 29/09 (aprovação na Meta pendente)',
  modelo_toque_30_dias: 'Rogério, 29/09 (aprovação na Meta pendente)',
};

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

/** Tudo que o Rogério ainda precisa preencher (prompt + KB). */
export function listPendingMarkers(): string[] {
  const texts = [buildArcadaSystemPrompt(), ...buildArcadaKbDocuments().map((d) => d.rawContent)];
  const out: string[] = [];
  for (const t of texts) for (const k of extractMarkers(t)) if (!out.includes(k)) out.push(k);
  return out;
}
