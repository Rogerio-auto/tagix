export type Highlight = {
  label: string;
  value: string;
  detail: string;
};

export type Feature = {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  badge?: string;
};

export type Pain = {
  id: string;
  before: string;
  after: string;
};

export type Niche = {
  id: string;
  label: string;
  useCase: string;
};

export type Plan = {
  id: "free" | "starter" | "pro" | "business";
  name: string;
  price: number;
  description: string;
  cta: string;
  badge?: string;
  quota: string;
  features: string[];
  notIncluded?: string[];
};

export type FAQ = {
  question: string;
  answer: string;
};

export type Principle = {
  title: string;
  description: string;
};

export type ContactChannel = {
  label: string;
  value: string;
  href?: string;
};

export const NAV_LINKS = [
  { label: "Início", path: "/" },
  { label: "Recursos", path: "/#features" },
  { label: "Nichos", path: "/#niches" },
  { label: "Preços", path: "/precos" },
  { label: "Contato", path: "/contato" },
];

/**
 * Sinais de confiança do hero — enquadramento honesto, sem números fabricados.
 */
export const HERO_HIGHLIGHTS: Highlight[] = [
  {
    label: "Canais oficiais",
    value: "WhatsApp + Instagram",
    detail: "Conexão oficial pela Meta — sem risco de bloqueio",
  },
  {
    label: "Responde sozinho",
    value: "IA 24 horas",
    detail: "Atende, qualifica e agenda enquanto você descansa",
  },
  {
    label: "Tudo em um lugar",
    value: "Time + IA juntos",
    detail: "Mensagem, venda e automação na mesma tela",
  },
];

/**
 * Palavras que giram no hero ("Cada conversa vira ___").
 */
export const HERO_ROTATING = ["venda", "agendamento", "cliente fiel", "oportunidade"];

/**
 * Microcopy do hero — gancho de transformação, não descrição de produto.
 */
export const HERO = {
  badge: "WhatsApp + Instagram oficiais · IA 24h",
  /** Headline fixa + parte que gira ("Cada conversa virando ___"). */
  titleLead: "Cada conversa virando",
  subhead:
    "A Leadium responde na hora, qualifica e agenda sozinha — no WhatsApp e no Instagram que você já usa. Seu time para de correr atrás de lead frio e foca em fechar.",
  ctaPrimary: { label: "Começar grátis", href: "/precos" },
  ctaSecondary: { label: "Ver como funciona", href: "#como-funciona" },
};

/**
 * Seção de dor — antes (a realidade que dói) vs. depois (com a Leadium).
 */
export const PAINS: Pain[] = [
  {
    id: "demora",
    before: "O cliente manda mensagem e espera horas. Quando você responde, ele já comprou no concorrente.",
    after: "Resposta na hora, dia e noite. Ninguém fica esperando — e ninguém escapa.",
  },
  {
    id: "afogado",
    before: "Seu time vive afogado em mensagem repetida e perde tempo com quem nem ia comprar.",
    after: "A IA filtra, responde o básico e só passa pro humano quem está pronto pra fechar.",
  },
  {
    id: "followup",
    before: "O follow-up depende de alguém lembrar. E quase sempre ninguém lembra.",
    after: "O acompanhamento dispara sozinho, no momento certo, sem depender de memória.",
  },
  {
    id: "caos",
    before: "WhatsApp num celular, Instagram noutro, planilha à parte. Vendas se perdem no caos.",
    after: "Tudo numa caixa só, com histórico, funil e métricas — você enxerga a operação inteira.",
  },
];

export const FEATURES: Feature[] = [
  {
    id: "coexistence",
    title: "Continue no número que você já usa",
    description:
      "Conecte o mesmo WhatsApp de sempre — sem trocar de chip, sem perder o histórico e sem parar de atender pelo celular. A Leadium entra junto, não no lugar.",
    bullets: [
      "Mantenha seu número e seus contatos",
      "As conversas antigas continuam ali",
      "Atenda pelo app e pela plataforma ao mesmo tempo",
    ],
    badge: "Exclusivo",
  },
  {
    id: "ai",
    title: "Uma IA que vende enquanto você dorme",
    description:
      "Um atendente que nunca dorme, nunca esquece e responde em segundos. Ela entende a sua empresa, qualifica o lead, agenda e só chama um humano quando vale a pena.",
    bullets: [
      "Responde em segundos, 24 horas por dia",
      "Aprende sobre o seu negócio e responde com precisão",
      "Passa pro seu time no momento certo de fechar",
    ],
    badge: "Mais querido",
  },
  {
    id: "flow",
    title: "Monte atendimentos que vendem sozinhos",
    description:
      "Desenhe o caminho do cliente arrastando blocos na tela — boas-vindas, qualificação, agendamento, recuperação. Sem programar, sem depender de TI.",
    bullets: [
      "Arraste e solte: zero código",
      "Pergunta certa na hora certa, no automático",
      "Recupera quem sumiu antes de virar venda perdida",
    ],
  },
  {
    id: "omnichannel",
    title: "WhatsApp e Instagram numa caixa só",
    description:
      "Toda mensagem cai no mesmo lugar, com o time inteiro vendo o que acontece em tempo real. Acabou o vai-e-volta entre aparelhos e abas.",
    bullets: [
      "Uma caixa de entrada para o time todo",
      "Distribui o atendimento por equipe e assunto",
      "Humano e IA conversam lado a lado",
    ],
    badge: "No ar",
  },
  {
    id: "crm",
    title: "Saiba exatamente onde cada venda está",
    description:
      "Cada conversa vira um card no seu funil. Você vê quem está quente, quem esfriou e o que falta para fechar — e a Leadium move o cliente de etapa sozinha.",
    bullets: [
      "Funil visual no seu jeito de vender",
      "Etiquetas, etapas e ações automáticas",
      "Tudo ligado à conversa que originou a venda",
    ],
  },
  {
    id: "campaigns",
    title: "Fale com milhares sem virar spam",
    description:
      "Dispare ofertas, lembretes e novidades para sua base inteira de uma vez — com mensagens aprovadas pela Meta e respeito a quem pediu para sair.",
    bullets: [
      "Envio em massa dentro das regras oficiais",
      "Segmente por perfil e comportamento",
      "Opt-out automático: nada de bloqueio",
    ],
  },
  {
    id: "calendar",
    title: "Agenda cheia, sem você mexer um dedo",
    description:
      "A IA e os fluxos marcam horários direto na agenda do time. Calendários por pessoa, empresa e equipe, com lembretes que reduzem o no-show.",
    bullets: [
      "Agendamento automático na conversa",
      "Agendas pessoal, da empresa e dos times",
      "Lembretes que diminuem faltas",
    ],
  },
  {
    id: "analytics",
    title: "Decisões com base em dado, não em achismo",
    description:
      "Painéis que mostram o que importa: quanto você vende, quanto seu time demora, o que o cliente acha do atendimento e quais objeções mais aparecem.",
    bullets: [
      "Vendas, tempo de resposta e satisfação num olhar",
      "Nota de satisfação do cliente avaliada por IA",
      "Veja as objeções que mais travam suas vendas",
    ],
  },
  {
    id: "api",
    title: "Conversa com as ferramentas que você já usa",
    description:
      "A Leadium se integra ao restante da sua operação por uma API aberta e webhooks — para o seu sistema receber cada lead e cada venda em tempo real.",
    bullets: [
      "Integra com o que você já tem",
      "Eventos em tempo real para o seu sistema",
      "Documentação pronta para o seu dev",
    ],
    badge: "Para devs",
  },
];

export const NICHES: Niche[] = [
  { id: "realestate", label: "Imobiliário", useCase: "Qualifica o lead e agenda a visita sozinho" },
  { id: "health", label: "Clínicas & Saúde", useCase: "Marca consultas e lembra o paciente do horário" },
  { id: "education", label: "Educação", useCase: "Tira dúvidas, nutre interessados e fecha matrículas" },
  { id: "solar", label: "Energia Solar", useCase: "Capta e qualifica antes de enviar proposta" },
  { id: "retail", label: "Varejo", useCase: "Vende pelo catálogo e traz o cliente de volta" },
  { id: "law", label: "Jurídico", useCase: "Triagem de casos e onboarding sem fricção" },
  { id: "agency", label: "Agências", useCase: "Atende vários clientes com times separados" },
];

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Para sair do caos e profissionalizar o seu primeiro canal.",
    cta: "Começar grátis",
    quota: "1 usuário • 1 canal • o essencial para começar",
    features: [
      "1 canal (WhatsApp ou Instagram)",
      "Caixa de entrada unificada em tempo real",
      "Funil e etiquetas para organizar as vendas",
      "Central de ajuda e suporte por chat",
    ],
    notIncluded: ["IA que atende sozinha", "Integrações (API)", "Envio em massa"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 99,
    description: "Para o time pequeno parar de perder venda por demora.",
    cta: "Assinar Starter",
    quota: "Até 3 usuários • vários canais",
    features: [
      "WhatsApp + Instagram oficiais",
      "Distribuição de atendimento por equipe",
      "Atendimentos automáticos sem código",
      "Funil, agendamentos e calendário",
      "Envio em massa dentro das regras da Meta",
    ],
    notIncluded: ["IA que atende sozinha", "Integrações (API)"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 299,
    description: "Para vender em escala com a IA trabalhando por você.",
    cta: "Assinar Pro",
    badge: "Mais popular",
    quota: "Times em crescimento • IA incluída",
    features: [
      "Tudo do Starter",
      "IA que atende, qualifica e agenda 24h",
      "IA treinada com o conhecimento do seu negócio",
      "Continue no número de WhatsApp que já usa",
      "Integrações por API e webhooks",
      "Painéis com vendas, satisfação e qualidade",
    ],
    notIncluded: ["Suporte com SLA dedicado"],
  },
  {
    id: "business",
    name: "Business",
    price: 999,
    description: "Para operações grandes que precisam de controle e governança.",
    cta: "Falar com o time",
    badge: "Escala",
    quota: "Vários times e departamentos",
    features: [
      "Tudo do Pro",
      "Várias IAs trabalhando em conjunto",
      "Times, departamentos e permissões por papel",
      "Limites ampliados de canais e usuários",
      "Suporte prioritário",
    ],
  },
];

export const FAQS: FAQ[] = [
  {
    question: "Vou ter que trocar o meu número de WhatsApp?",
    answer:
      "Não. Você conecta o mesmo número que já usa, mantém o histórico das conversas e continua atendendo pelo celular. A Leadium entra junto com o seu WhatsApp, não no lugar dele.",
  },
  {
    question: "Esse WhatsApp é seguro? Tem risco de bloqueio?",
    answer:
      "É a conexão oficial da Meta — a mesma que grandes empresas usam. Nada de aplicativos paralelos ou gambiarras que põem o seu número em risco. Você opera dentro das regras, com tranquilidade.",
  },
  {
    question: "Preciso saber programar para usar?",
    answer:
      "Não. Você monta os atendimentos arrastando blocos na tela, e a IA já vem pronta para aprender sobre o seu negócio. Se o seu time tiver desenvolvedores, há ainda uma API aberta para integrar com outros sistemas.",
  },
  {
    question: "A IA responde como um robô engessado?",
    answer:
      "Não. Ela entende o contexto da sua empresa, conversa de forma natural e sabe a hora de passar para um atendente humano — para que o cliente nunca sinta que está falando com uma máquina sem saída.",
  },
  {
    question: "Meus dados e os dos meus clientes ficam protegidos?",
    answer:
      "Sim. Os dados de cada empresa ficam isolados, as credenciais dos canais são criptografadas e tudo trafega com segurança. Privacidade é fundação aqui, em conformidade com a LGPD.",
  },
  {
    question: "Tem fidelidade ou taxa para começar?",
    answer:
      "Não. Você começa pelo plano gratuito, sobe de nível quando a operação pedir e cancela quando quiser. Sem taxa de ativação e sem contrato de fidelidade.",
  },
];

/**
 * Garantias do produto — substituem depoimentos fictícios.
 * A Leadium é nova; aqui afirmamos o que entregamos, não clientes inventados.
 */
export const PRINCIPLES: Principle[] = [
  {
    title: "Oficial de verdade",
    description:
      "WhatsApp e Instagram pela conexão oficial da Meta. Nada que coloque o seu número em risco ou fira as regras das plataformas.",
  },
  {
    title: "IA que ajuda, não que atrapalha",
    description:
      "Uma inteligência que entende o seu negócio, resolve o que dá para resolver e devolve a conversa pro humano na hora certa.",
  },
  {
    title: "Seus dados, só seus",
    description:
      "Os dados de cada empresa ficam isolados e as credenciais criptografadas. Privacidade tratada como fundação, em conformidade com a LGPD.",
  },
];

export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    label: "E-mail",
    value: "contato@leadium.com.br",
    href: "mailto:contato@leadium.com.br",
  },
];
