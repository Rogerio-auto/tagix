/**
 * Seed idempotente da Central de Ajuda (F38-S01). Conteudo de exemplo da equipe
 * Leadium: categorias + artigos publicados (com anchor_key para o help
 * contextual). Idempotente por slug (UNIQUE) via onConflictDoNothing.
 *
 * Produto = Leadium em toda string product-facing (nunca "Tagix").
 */
import type { DB } from '../client';
import { helpArticles, helpCategories } from '../schema';

type CategorySeed = {
  slug: string;
  title: string;
  description: string;
  icon: string;
  order: number;
};

type ArticleSeed = {
  categorySlug: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  anchorKey: string | null;
  order: number;
};

const CATEGORIES: readonly CategorySeed[] = [
  {
    slug: 'primeiros-passos',
    title: 'Primeiros passos',
    description: 'Configure seu workspace na Leadium e comece a atender.',
    icon: 'rocket',
    order: 0,
  },
  {
    slug: 'agentes-ia',
    title: 'Agentes de IA',
    description: 'Crie e configure agentes que atendem automaticamente.',
    icon: 'bot',
    order: 1,
  },
  {
    slug: 'canais',
    title: 'Canais',
    description: 'Conecte WhatsApp e Instagram ao seu workspace.',
    icon: 'message-circle',
    order: 2,
  },
  {
    slug: 'api-e-webhooks',
    title: 'API e Webhooks',
    description: 'Integre a Leadium aos seus sistemas via API e eventos.',
    icon: 'code',
    order: 3,
  },
];

const ARTICLES: readonly ArticleSeed[] = [
  {
    categorySlug: 'primeiros-passos',
    slug: 'bem-vindo-a-leadium',
    title: 'Bem-vindo a Leadium',
    excerpt: 'Visao geral da plataforma e do que voce pode fazer.',
    bodyMd:
      '# Bem-vindo a Leadium\n\nA **Leadium** centraliza atendimento, vendas conversacionais e automacao.\n\n- Conecte seus canais (WhatsApp, Instagram).\n- Crie agentes de IA para atender 24/7.\n- Acompanhe conversoes no pipeline.\n\nComece criando seu primeiro canal em **Configuracoes**.',
    anchorKey: null,
    order: 0,
  },
  {
    categorySlug: 'primeiros-passos',
    slug: 'convidando-sua-equipe',
    title: 'Convidando sua equipe',
    excerpt: 'Adicione membros e defina papeis no workspace.',
    bodyMd:
      '# Convidando sua equipe\n\nEm **Configuracoes > Membros**, convide pessoas por e-mail.\n\nPapeis disponiveis: OWNER, ADMIN, SUPERVISOR, AGENT e READONLY. Cada papel tem permissoes especificas.',
    anchorKey: 'members.invite',
    order: 1,
  },
  {
    categorySlug: 'agentes-ia',
    slug: 'criando-seu-primeiro-agente',
    title: 'Criando seu primeiro agente',
    excerpt: 'Configure um agente de IA do zero em minutos.',
    bodyMd:
      '# Criando seu primeiro agente\n\nVa em **Agentes** e clique em **Novo agente**.\n\n1. Defina nome e personalidade.\n2. Escreva o prompt do sistema.\n3. Escolha o modelo de linguagem.\n4. Conecte a base de conhecimento (opcional).\n\nO agente assume conversas automaticamente nos departamentos vinculados.',
    anchorKey: 'agents.create',
    order: 0,
  },
  {
    categorySlug: 'canais',
    slug: 'conectando-o-whatsapp',
    title: 'Conectando o WhatsApp',
    excerpt: 'Vincule um numero WhatsApp Business ao seu workspace.',
    bodyMd:
      '# Conectando o WhatsApp\n\nEm **Configuracoes > Canais**, escolha **WhatsApp** e siga o fluxo de autenticacao com a Meta. Voce precisara de uma conta WhatsApp Business ativa.',
    anchorKey: 'channels.whatsapp',
    order: 0,
  },
  {
    categorySlug: 'api-e-webhooks',
    slug: 'gerando-uma-api-key',
    title: 'Gerando uma API key',
    excerpt: 'Crie chaves para integrar a Leadium aos seus sistemas.',
    bodyMd:
      '# Gerando uma API key\n\nEm **Configuracoes > Desenvolvedor**, gere uma API key com os escopos necessarios. A chave so e exibida uma vez — guarde com seguranca.\n\nUse o header `Authorization: Bearer SUA_CHAVE` nas chamadas a `/api/v1`.',
    anchorKey: 'developers.apikey',
    order: 0,
  },
];

/**
 * Aplica o seed da Central de Ajuda. Idempotente: upsert por slug. Usa a conexao
 * owner (sem RLS) — help_categories/help_articles sao platform-level.
 */
export async function seedHelpCenter(db: DB): Promise<void> {
  await db
    .insert(helpCategories)
    .values(CATEGORIES.map((c) => ({ ...c })))
    .onConflictDoNothing({ target: helpCategories.slug });

  const cats = await db.select().from(helpCategories);
  const bySlug = new Map(cats.map((c) => [c.slug, c.id]));

  for (const a of ARTICLES) {
    const categoryId = bySlug.get(a.categorySlug);
    if (!categoryId) continue;
    await db
      .insert(helpArticles)
      .values({
        categoryId,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        bodyMd: a.bodyMd,
        status: 'published',
        order: a.order,
        anchorKey: a.anchorKey,
        publishedAt: new Date(),
      })
      .onConflictDoNothing({ target: helpArticles.slug });
  }
}
