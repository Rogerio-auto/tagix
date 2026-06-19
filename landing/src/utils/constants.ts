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
 * Capacidades reais da plataforma — enquadramento honesto, sem números fabricados.
 */
export const HERO_HIGHLIGHTS: Highlight[] = [
  {
    label: "Canais oficiais",
    value: "WhatsApp + Instagram",
    detail: "API oficial da Meta, como Tech Provider",
  },
  {
    label: "Atendimento + IA",
    value: "Inbox unificado",
    detail: "Humano e agentes de IA na mesma caixa",
  },
  {
    label: "Construído para escalar",
    value: "Multi-tenant",
    detail: "Isolamento por workspace com RLS",
  },
];

export const FEATURES: Feature[] = [
  {
    id: "omnichannel",
    title: "Atendimento omnichannel",
    description:
      "WhatsApp e Instagram pela API oficial da Meta em um inbox unificado, com tempo real via Socket.io e roteamento por departamento.",
    bullets: [
      "Inbox único para WhatsApp e Instagram",
      "Handoff humano ↔ IA em 1 clique",
      "Roteamento por fila, tag e departamento",
    ],
    badge: "Ao vivo",
  },
  {
    id: "coexistence",
    title: "WhatsApp Coexistence",
    description:
      "Conecte um número que já roda no app WhatsApp Business e na Cloud API ao mesmo tempo — com sincronização do histórico e das mensagens enviadas pelo próprio app.",
    bullets: [
      "Use o app e a plataforma no mesmo número",
      "Histórico de conversas sincronizado",
      "Mensagens enviadas pelo app aparecem no inbox",
    ],
    badge: "Diferencial",
  },
  {
    id: "ai",
    title: "Agentes de IA",
    description:
      "Agentes construídos em LangGraph e roteados pelo OpenRouter, com base de conhecimento (RAG), roteamento agente↔departamento e handoff contextual.",
    bullets: [
      "OpenRouter roteia entre modelos líderes",
      "Base de conhecimento (RAG) e playground",
      "Multi-agente com handoff contextual",
    ],
    badge: "LangGraph",
  },
  {
    id: "flow",
    title: "Flow Builder visual",
    description:
      "Desenhe automações com drag-and-drop: cerca de 22 tipos de nó, condições, gatilhos e ramificações — tudo sem escrever código.",
    bullets: [
      "~22 tipos de nó e ramificações condicionais",
      "Gatilhos por evento, tag e horário",
      "Execução monitorada em fila",
    ],
  },
  {
    id: "crm",
    title: "Pipeline & CRM",
    description:
      "Funil de vendas configurável com conversões, tags e automações de deal conectadas diretamente às conversas.",
    bullets: [
      "Funil configurável por operação",
      "Conversões, tags e automações de deal",
      "Tudo ligado à conversa de origem",
    ],
  },
  {
    id: "campaigns",
    title: "Campanhas",
    description:
      "Envios com templates aprovados pela Meta, compliance dura, opt-out, segmentação e rate limiting para proteger sua operação.",
    bullets: [
      "Templates aprovados pela Meta",
      "Opt-out e compliance integrados",
      "Segmentação e rate limiting automáticos",
    ],
  },
  {
    id: "calendar",
    title: "Calendário",
    description:
      "Multi-calendário (pessoal, empresa e times) com eventos recorrentes e controle de visibilidade por papel.",
    bullets: [
      "Calendários pessoal, de empresa e de times",
      "Eventos recorrentes",
      "Visibilidade controlada por papel",
    ],
  },
  {
    id: "analytics",
    title: "Dashboards role-aware",
    description:
      "Painéis que se adaptam ao papel do usuário, com métricas de atendimento, CSAT e avaliação de qualidade e objeções por IA.",
    bullets: [
      "Métricas por papel (role-aware)",
      "CSAT e qualidade avaliados por IA",
      "Leitura de objeções recorrentes",
    ],
  },
  {
    id: "api",
    title: "API pública v1 & Webhooks",
    description:
      "Portal de desenvolvedor com API REST v1 documentada em OpenAPI e webhooks para integrar a Leadium ao seu stack.",
    bullets: [
      "API REST v1 com OpenAPI",
      "Webhooks para eventos da plataforma",
      "Portal de desenvolvedor dedicado",
    ],
    badge: "Para devs",
  },
  {
    id: "security",
    title: "Segurança & LGPD",
    description:
      "Multi-tenant com Row-Level Security, criptografia das credenciais de canal, autenticação Supabase e conformidade com a LGPD.",
    bullets: [
      "Isolamento por workspace com RLS",
      "Credenciais de canal criptografadas",
      "Conformidade com a LGPD",
    ],
  },
];

export const NICHES: Niche[] = [
  { id: "realestate", label: "Imobiliário", useCase: "Qualificação de leads e follow-up de visitas" },
  { id: "health", label: "Clínicas & Saúde", useCase: "Agendamentos, lembretes e triagem inicial" },
  { id: "education", label: "Educação", useCase: "Matrículas, dúvidas e nutrição de interessados" },
  { id: "solar", label: "Energia Solar", useCase: "Captação e qualificação de propostas" },
  { id: "retail", label: "Varejo", useCase: "Catálogo, pós-venda e recompra" },
  { id: "law", label: "Jurídico", useCase: "Triagem de casos e onboarding de clientes" },
  { id: "agency", label: "Agências", useCase: "Atendimento multi-cliente com times e departamentos" },
];

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Para conhecer a plataforma e validar seu primeiro canal.",
    cta: "Começar grátis",
    quota: "1 usuário • 1 canal • recursos essenciais",
    features: [
      "1 canal (WhatsApp ou Instagram)",
      "Inbox unificado em tempo real",
      "Pipeline e tags básicos",
      "Central de Ajuda e chat de suporte",
    ],
    notIncluded: ["Agentes de IA", "API & Webhooks", "Campanhas"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 99,
    description: "Para times pequenos profissionalizarem o atendimento.",
    cta: "Assinar Starter",
    quota: "Até 3 usuários • múltiplos canais",
    features: [
      "WhatsApp + Instagram (API oficial)",
      "Roteamento por fila e departamento",
      "Flow Builder visual",
      "Pipeline, conversões e calendário",
      "Campanhas com templates aprovados",
    ],
    notIncluded: ["Agentes de IA", "API & Webhooks"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 299,
    description: "Para operações que escalam com IA e integrações.",
    cta: "Assinar Pro",
    badge: "Mais popular",
    quota: "Times em crescimento • IA incluída",
    features: [
      "Tudo do Starter",
      "Agentes de IA (LangGraph + OpenRouter)",
      "Base de conhecimento (RAG) e playground",
      "WhatsApp Coexistence",
      "API pública v1 e Webhooks",
      "Dashboards role-aware com CSAT e qualidade",
    ],
    notIncluded: ["SLA dedicado"],
  },
  {
    id: "business",
    name: "Business",
    price: 999,
    description: "Para operações em escala que precisam de governança.",
    cta: "Falar com o time",
    badge: "Escala",
    quota: "Múltiplos times e departamentos",
    features: [
      "Tudo do Pro",
      "Multi-agente e roteamento agente↔departamento",
      "Times, departamentos e visibilidade granular",
      "Limites ampliados de canais e usuários",
      "Suporte prioritário",
    ],
  },
];

export const FAQS: FAQ[] = [
  {
    question: "A Leadium usa a API oficial do WhatsApp?",
    answer:
      "Sim. WhatsApp e Instagram são conectados pela API oficial da Meta, com a Leadium atuando como Tech Provider. Você opera dentro das políticas oficiais, sem gambiarras.",
  },
  {
    question: "O que é o WhatsApp Coexistence?",
    answer:
      "É a possibilidade de conectar um número que já roda no app do WhatsApp Business à Cloud API ao mesmo tempo. A plataforma sincroniza o histórico e as mensagens enviadas pelo próprio app, sem interromper seu atendimento atual.",
  },
  {
    question: "Como funcionam os agentes de IA?",
    answer:
      "Os agentes são construídos em LangGraph e usam o OpenRouter para rotear entre modelos líderes. Eles consultam uma base de conhecimento (RAG), podem trabalhar em conjunto (multi-agente) e fazem handoff contextual para um humano quando necessário.",
  },
  {
    question: "Preciso saber programar para criar automações?",
    answer:
      "Não. O Flow Builder é visual, com drag-and-drop, cerca de 22 tipos de nó, condições e gatilhos. Para times técnicos, há ainda a API pública v1 e webhooks.",
  },
  {
    question: "Como a Leadium trata a segurança e a LGPD?",
    answer:
      "A plataforma é multi-tenant com Row-Level Security (isolamento por workspace), criptografa as credenciais de canal, usa autenticação Supabase e foi construída em conformidade com a LGPD.",
  },
];

/**
 * Princípios do produto — substituem depoimentos fictícios.
 * A Leadium é nova; aqui afirmamos o que garantimos, não clientes inventados.
 */
export const PRINCIPLES: Principle[] = [
  {
    title: "Canais oficiais, sempre",
    description:
      "WhatsApp e Instagram via API oficial da Meta. Nada de soluções que arriscam o seu número ou ferem as políticas das plataformas.",
  },
  {
    title: "IA com contexto, não promessas",
    description:
      "Agentes em LangGraph e OpenRouter que consultam sua base de conhecimento e devolvem o atendimento ao humano quando faz sentido.",
  },
  {
    title: "Seus dados, isolados",
    description:
      "Arquitetura multi-tenant com Row-Level Security e credenciais criptografadas. Privacidade tratada como fundação, em conformidade com a LGPD.",
  },
];

export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    label: "E-mail",
    value: "contato@leadium.com.br",
    href: "mailto:contato@leadium.com.br",
  },
];
