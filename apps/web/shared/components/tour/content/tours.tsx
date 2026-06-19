/**
 * Conteúdo dos tours guiados das telas-chave (F43-S08 / ONBOARDING.md §4.2).
 *
 * Cada tour é um `TourDefinition` declarativo: passos pt-BR que apontam a AÇÃO
 * PRIMÁRIA visível da tela (UX §2.4 — caminho óbvio, nunca menu escondido) e 1-2
 * pontos didáticos. Os textos reaproveitam e expandem o `HELP_CONTENT` do
 * `HelpHint` (UX §2.5/§3.3 — explicação real, não tooltip de 1 linha).
 *
 * As âncoras (`target`) batem com os `data-tour-id` adicionados nas telas. Se uma
 * âncora não existir na tela atual (lista vazia, role sem permissão), o engine
 * (F43-S07) pula o passo graciosamente — por isso é seguro descrever a ação
 * primária mesmo quando ela é condicional (ex.: botão "Criar" só com permissão).
 *
 * Convenção de id: `tour:<tela>`. Mudar o id "reabre" o tour para todos os
 * membros (chave de persistência em `members.tour_state`) — não reusar.
 */
import type { TourDefinition } from '../types';

/** Dashboard (`/`) — como ler as métricas e personalizar a tela. */
const DASHBOARD_TOUR: TourDefinition = {
  id: 'tour:dashboard',
  steps: [
    {
      target: 'dashboard-header',
      title: 'Seu dashboard',
      body: 'Aqui ficam as métricas que importam para o seu papel. A lista de cards é definida pelo servidor a partir da sua função — você vê só o que é relevante para você, agrupado por categoria (Atendimento, Conversões, Pipeline, Campanhas, Agentes IA, Negócio).',
      placement: 'bottom',
    },
    {
      target: 'dashboard-customize',
      title: 'Personalize a visão',
      body: 'Use "Personalizar" para esconder e reordenar cards. A preferência é só sua e fica salva — monte o painel do jeito que você trabalha.',
      placement: 'left',
    },
    {
      target: 'dashboard-grid',
      title: 'Detalhe sem sair da tela',
      body: 'Os números atualizam em tempo real. Cards com seta abrem o detalhe (drill-down) num painel lateral, sem perder o resto do dashboard de vista.',
      placement: 'top',
    },
  ],
};

/** Conversas / Inbox (`/conversations`) — atender uma conversa. */
const INBOX_TOUR: TourDefinition = {
  id: 'tour:inbox',
  steps: [
    {
      target: 'inbox-list',
      title: 'Sua caixa de conversas',
      body: 'Todas as conversas dos seus canais (WhatsApp e Instagram) chegam aqui em tempo real. Filtre por status, busque por contato e veja o que ainda não foi lido — tudo numa lista só.',
      placement: 'right',
    },
    {
      target: 'inbox-list',
      title: 'Abra para atender',
      body: 'Clique numa conversa da lista para abrir a thread e começar a atender. As mensagens novas, "digitando…" e os recibos de leitura aparecem ao vivo, sem recarregar.',
      placement: 'right',
    },
    {
      title: 'Cockpit do contato',
      body: 'Com uma conversa aberta, o cockpit lateral reúne contato, negócio e ações rápidas (atribuir, encerrar, rodar um flow manual) — o contexto do atendimento num lugar só.',
      placement: 'bottom',
    },
  ],
};

/** Pipeline (`/pipeline`) — mover negócios entre estágios. */
const PIPELINE_TOUR: TourDefinition = {
  id: 'tour:pipeline',
  steps: [
    {
      target: 'pipeline-selector',
      title: 'Seu funil de vendas',
      body: 'O pipeline é um quadro de estágios (kanban). Cada cartão é um negócio que avança da esquerda para a direita conforme a negociação progride. Troque de pipeline aqui quando tiver mais de um funil.',
      placement: 'bottom',
    },
    {
      target: 'pipeline-board',
      title: 'Arraste para avançar',
      body: 'Arraste um cartão entre colunas para mudar o estágio (ou use o teclado: Espaço para pegar, setas para mover, Espaço para soltar). Transições inválidas são bloqueadas com um aviso — as regras do funil são respeitadas.',
      placement: 'top',
    },
    {
      target: 'pipeline-board',
      title: 'Detalhe do negócio',
      body: 'Clique num cartão para abrir o detalhe no painel lateral, sem perder o quadro de vista. Conversões e histórico do negócio ficam na timeline dentro do detalhe.',
      placement: 'top',
    },
  ],
};

/** Agentes IA (`/agents`) — criar e ativar um agente. */
const AGENTS_TOUR: TourDefinition = {
  id: 'tour:agents',
  steps: [
    {
      target: 'agents-create',
      title: 'Crie um agente IA',
      body: 'Comece por aqui: o assistente monta um agente a partir de um template (atendimento, vendas, qualificação) e te guia pela persona, objetivo e ferramentas. Em poucos passos ele já está pronto para conversar.',
      placement: 'bottom',
    },
    {
      target: 'agents-list',
      title: 'Ligue e desligue na hora',
      body: 'Cada agente aparece aqui com seu status. Ative para que ele passe a responder nas conversas dos canais conectados — e desative a qualquer momento sem perder a configuração.',
      placement: 'top',
    },
  ],
};

/** Flows (`/flows`) — automação determinística sem IA no loop. */
const FLOWS_TOUR: TourDefinition = {
  id: 'tour:flows',
  steps: [
    {
      target: 'flows-create',
      title: 'Automatize com flows',
      body: 'Um flow é um grafo visual de passos determinísticos — sem IA no loop. Cada nó executa uma ação (enviar mensagem, mover estágio, adicionar tag, chamar uma API) ou decide um caminho. Clique aqui para criar o primeiro.',
      placement: 'bottom',
    },
    {
      target: 'flows-list',
      title: 'Publique para ativar',
      body: 'Seus flows ficam nesta lista com o status. Todo flow começa por um gatilho (mensagem, palavra-chave, resposta de formulário) e só passa a rodar depois de publicado — erros de validação aparecem antes da publicação.',
      placement: 'top',
    },
  ],
};

/** Registro de todos os tours disponíveis no shell (consumido pelo `TourProvider`). */
export const APP_TOURS: TourDefinition[] = [
  DASHBOARD_TOUR,
  INBOX_TOUR,
  PIPELINE_TOUR,
  AGENTS_TOUR,
  FLOWS_TOUR,
];

/**
 * Mapa rota → tourId para o auto-start por tela (GuidedTourMount). Casa com os
 * paths reais de `apps/web/app/(app)/`. Comparação por igualdade exata da rota
 * de listagem (telas de detalhe como `/conversations/:id` não auto-disparam).
 */
export const TOUR_BY_PATHNAME: Record<string, string> = {
  '/': DASHBOARD_TOUR.id,
  '/conversations': INBOX_TOUR.id,
  '/pipeline': PIPELINE_TOUR.id,
  '/agents': AGENTS_TOUR.id,
  '/flows': FLOWS_TOUR.id,
};
