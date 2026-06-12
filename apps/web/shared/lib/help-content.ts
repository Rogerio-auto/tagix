import { createElement, type ReactNode } from 'react';

/**
 * Registry tipado de ajuda contextual inline (`?`).
 *
 * Cada entrada é um pedaço de ajuda REAL (título + corpo rico + link opcional),
 * consumido pelo `<HelpHint k="..."/>` ao lado do nome de uma seção/feature.
 * UX §2.5: nunca tooltip de 1 linha — aqui mora a explicação completa.
 *
 * Para adicionar um tópico de ajuda: acrescente uma `HelpKey` e a entrada
 * correspondente em `HELP_CONTENT`. O `satisfies` garante cobertura total e tipa
 * `k` no call-site — chave inexistente é erro de compilação (zero `any`).
 *
 * Nota: este arquivo é importado por Server e Client Components, então o `body`
 * é montado como dados (sem hooks). Mantenha o markup leve (`<p>`, `<ul>/<li>`,
 * `<strong>`, `<code>`) — o `HelpPanel` do DS já estiliza esses elementos.
 */

export interface HelpEntry {
  title: string;
  body: ReactNode;
  link?: { label: string; href: string };
}

// --- helpers de markup (sem JSX para manter o arquivo .ts e SSR-safe) ---------

function paragraph(text: string): ReactNode {
  return createElement('p', { key: `p:${text.slice(0, 24)}` }, text);
}

function bullets(items: readonly string[]): ReactNode {
  return createElement(
    'ul',
    { key: `ul:${items[0]?.slice(0, 24) ?? ''}` },
    ...items.map((t) => createElement('li', { key: `li:${t.slice(0, 24)}` }, t)),
  );
}

function body(children: readonly ReactNode[]): ReactNode {
  return createElement('div', null, ...children);
}

// --- registry ----------------------------------------------------------------

export type HelpKey = 'dashboard.overview' | 'pipeline.board' | 'flow.canvas';

export const HELP_CONTENT = {
  'dashboard.overview': {
    title: 'Como ler o dashboard',
    body: body([
      paragraph(
        'O dashboard mostra as métricas que importam para o seu papel. A lista de cards é definida pelo servidor a partir da sua role — você vê só o que é relevante para você.',
      ),
      paragraph(
        'Cards são agrupados por categoria (Atendimento, Conversões, Pipeline, Campanhas, Agentes IA, Negócio). Os números atualizam em tempo real via socket.',
      ),
      bullets([
        'Cards de número com seta abrem o detalhe (drill-down) no painel lateral.',
        'Use "Personalizar" para esconder e reordenar cards — a preferência é só sua.',
      ]),
    ]),
    link: { label: 'Documentação do dashboard', href: '/docs/dashboard' },
  },
  'pipeline.board': {
    title: 'Como funciona o pipeline',
    body: body([
      paragraph(
        'O pipeline é um quadro de estágios (kanban). Cada cartão é um negócio (deal) que avança da esquerda para a direita conforme a negociação progride.',
      ),
      paragraph(
        'Arraste um cartão entre colunas para mudar o estágio. Algumas transições têm regras: se um estágio só aceita vir de certos estágios, o movimento inválido é bloqueado com um aviso.',
      ),
      bullets([
        'Clique no cartão para abrir o detalhe no painel lateral — sem perder o quadro de vista.',
        'Conversões e histórico do negócio ficam na timeline dentro do detalhe.',
      ]),
    ]),
    link: { label: 'Documentação do pipeline', href: '/docs/pipeline' },
  },
  'flow.canvas': {
    title: 'Como montar um flow',
    body: body([
      paragraph(
        'Um flow é um grafo visual de nós determinísticos — sem IA no loop. Cada nó executa uma ação (enviar mensagem, mover estágio, adicionar tag, chamar uma API) ou decide um caminho (condição, switch).',
      ),
      paragraph(
        'Arraste nós da paleta para o canvas e conecte as saídas. Clique num nó para selecioná-lo e abrir o inspector lateral; a engrenagem do nó é só para ações secundárias.',
      ),
      bullets([
        'O flow começa por um gatilho (mensagem, palavra-chave, resposta de formulário).',
        'Publique para ativar. Erros de validação aparecem no banner antes de publicar.',
      ]),
    ]),
    link: { label: 'Documentação do Flow Builder', href: '/docs/flows' },
  },
} satisfies Record<HelpKey, HelpEntry>;

export function getHelp(key: HelpKey): HelpEntry {
  return HELP_CONTENT[key];
}
