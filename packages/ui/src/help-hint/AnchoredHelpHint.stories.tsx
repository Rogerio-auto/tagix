import { AnchoredHelpHint } from './AnchoredHelpHint';
import type { AnchoredHelpArticle } from './types';

const article: AnchoredHelpArticle = {
  slug: 'como-criar-um-agente',
  title: 'Como criar um agente',
  excerpt: 'Crie um agente IA a partir de um template em poucos passos.',
  bodyMd: [
    '## Passo a passo',
    '',
    'Escolha um **template** (vendas, recepcao, suporte), responda algumas',
    'perguntas e selecione o modelo.',
    '',
    '- O prompt inicial ja vem pronto.',
    '- As ferramentas do agente vem do template.',
    '',
    'Veja `register_conversion` para registrar vendas automaticamente.',
  ].join('\n'),
};

export const WithArticle = () => (
  <div className="flex items-center gap-2">
    <h2 className="font-head text-sm uppercase tracking-wide text-text-low">Agentes</h2>
    <AnchoredHelpHint anchorKey="agents.list" fetcher={() => Promise.resolve(article)} />
  </div>
);

export const Fallback = () => (
  <div className="flex items-center gap-2">
    <h2 className="font-head text-sm uppercase tracking-wide text-text-low">Sem conteudo</h2>
    <AnchoredHelpHint anchorKey="inexistente" fetcher={() => Promise.resolve(null)} />
  </div>
);
