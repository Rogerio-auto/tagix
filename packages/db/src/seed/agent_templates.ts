/**
 * Seed dos 5 templates GLOBAIS de agente (AGENTS_LANGGRAPH §16 / DATA_MODEL §7.2–7.3)
 * + suas `agent_template_questions` (wizard de criação).
 *
 * Templates globais: `workspace_id IS NULL`, `is_global = true` — legíveis por todos
 * os workspaces. Default model: `openai/gpt-4o-mini` (ADR-022, OpenRouter slug).
 *
 * IDEMPOTÊNCIA: ids estáveis e determinísticos.
 *  - template.id: UUID fixo por `key` (TEMPLATE_IDS).
 *  - question.id: UUIDv5 derivado de (template.id, question.key) — estável entre runs.
 *  - upsert por chave única (`agent_templates_workspace_key_uq`,
 *    `agent_template_questions_template_key_uq`) com onConflictDoUpdate: re-rodar
 *    atualiza o conteúdo (prompt/tools/perguntas) sem duplicar nem perder FKs.
 *
 * Importado e chamado por `packages/db/src/seed.ts` (wiring = orchestrator):
 *   import { seedAgentTemplates } from './seed/agent_templates';
 *   await seedAgentTemplates(db);
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DB } from '../client';
import { agentTemplateQuestions, agentTemplates } from '../schema';

type AgentTemplateInsert = typeof agentTemplates.$inferInsert;
type AgentTemplateQuestionInsert = typeof agentTemplateQuestions.$inferInsert;

/** UUIDv5 (namespace + name → hash SHA-1) determinístico, sem dependência externa. */
function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID fixo por template key. Estável e legível (prefixo `a9e7...` + índice). */
const TEMPLATE_IDS = {
  sales: 'a9e7c0d1-0001-4001-8001-000000000001',
  reception: 'a9e7c0d1-0002-4002-8002-000000000002',
  support: 'a9e7c0d1-0003-4003-8003-000000000003',
  first_touch: 'a9e7c0d1-0004-4004-8004-000000000004',
  follow_up: 'a9e7c0d1-0005-4005-8005-000000000005',
} as const;

type TemplateKey = keyof typeof TEMPLATE_IDS;

/** Namespace para derivar ids de perguntas via UUIDv5 (não muda nunca). */
const QUESTION_NS = 'a9e7c0d1-0000-4000-8000-000000000000';

interface QuestionSeed {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'multiselect';
  required: boolean;
  help?: string;
  options?: unknown[];
}

interface TemplateSeed {
  key: TemplateKey;
  name: string;
  category: string;
  description: string;
  promptTemplate: string;
  defaultTools: string[];
  questions: QuestionSeed[];
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/** Perguntas comuns reutilizadas por vários templates do wizard. */
const Q_BUSINESS_NAME: QuestionSeed = {
  key: 'business_name',
  label: 'Nome da empresa',
  type: 'text',
  required: true,
  help: 'Como o agente deve se referir à sua empresa.',
};
const Q_TONE: QuestionSeed = {
  key: 'tone',
  label: 'Tom de voz',
  type: 'select',
  required: true,
  help: 'Estilo de comunicação do agente com o cliente.',
  options: ['amigável', 'profissional', 'descontraído', 'formal', 'consultivo'],
};

const TEMPLATES: readonly TemplateSeed[] = [
  {
    key: 'sales',
    name: 'Vendedor',
    category: 'Comercial',
    description: 'Agente comercial que qualifica leads, apresenta produtos e move deals no pipeline.',
    promptTemplate: [
      'Você é um vendedor da {{business_name}}, especialista em {{product_summary}}.',
      'Seu objetivo é qualificar o lead, entender a necessidade e conduzir à decisão de compra.',
      'Tom de voz: {{tone}}. Seja consultivo, nunca insistente.',
      'Use a base de conhecimento antes de afirmar qualquer detalhe de produto ou preço.',
      'Quando o lead demonstrar intenção clara, mova o deal de stage e ofereça agendar uma conversa.',
    ].join('\n'),
    defaultTools: [
      'query_contact',
      'update_contact',
      'add_contact_tag',
      'move_deal_stage',
      'search_knowledge_base',
      'schedule_event',
    ],
    questions: [
      Q_BUSINESS_NAME,
      {
        key: 'product_summary',
        label: 'O que você vende',
        type: 'textarea',
        required: true,
        help: 'Resumo dos produtos/serviços e da proposta de valor.',
      },
      Q_TONE,
      {
        key: 'qualification_criteria',
        label: 'Critérios de qualificação',
        type: 'textarea',
        required: false,
        help: 'O que torna um lead qualificado (orçamento, autoridade, necessidade, prazo).',
      },
    ],
  },
  {
    key: 'reception',
    name: 'Recepcionista',
    category: 'Atendimento',
    description: 'Recepcionista que dá as boas-vindas, triagem inicial e direciona ao time certo.',
    promptTemplate: [
      'Você é a recepcionista virtual da {{business_name}}.',
      'Dê as boas-vindas, entenda rapidamente a necessidade e direcione ao departamento certo.',
      'Tom de voz: {{tone}}.',
      'Horário de atendimento: {{business_hours}}.',
      'Se a solicitação exigir um humano, transfira de forma clara e cordial.',
    ].join('\n'),
    defaultTools: ['query_contact', 'update_contact', 'change_conversation_status', 'transfer_to_human'],
    questions: [
      Q_BUSINESS_NAME,
      Q_TONE,
      {
        key: 'business_hours',
        label: 'Horário de atendimento',
        type: 'text',
        required: false,
        help: 'Ex.: Seg a Sex, 9h às 18h.',
      },
      {
        key: 'departments',
        label: 'Departamentos para triagem',
        type: 'textarea',
        required: false,
        help: 'Lista de áreas para onde o agente pode direcionar (ex.: Vendas, Suporte, Financeiro).',
      },
    ],
  },
  {
    key: 'support',
    name: 'Suporte',
    category: 'Atendimento',
    description: 'Agente de suporte que resolve dúvidas com base no conhecimento e escala quando necessário.',
    promptTemplate: [
      'Você é um agente de suporte da {{business_name}}.',
      'Resolva dúvidas e problemas consultando sempre a base de conhecimento antes de responder.',
      'Tom de voz: {{tone}}.',
      'Se não encontrar a resposta ou o caso for sensível, escale para um supervisor.',
      'Quando o problema for resolvido, marque a conversa como resolvida.',
    ].join('\n'),
    defaultTools: ['query_contact', 'search_knowledge_base', 'escalate_to_supervisor', 'mark_resolved'],
    questions: [
      Q_BUSINESS_NAME,
      Q_TONE,
      {
        key: 'escalation_policy',
        label: 'Política de escalonamento',
        type: 'textarea',
        required: false,
        help: 'Quando o agente deve escalar para um humano em vez de resolver sozinho.',
      },
    ],
  },
  {
    key: 'first_touch',
    name: 'First Touch (outreach inicial)',
    category: 'Marketing',
    description: 'Agente de primeiro contato para outreach: abre conversa, qualifica interesse e captura dados.',
    promptTemplate: [
      'Você faz o primeiro contato em nome da {{business_name}}.',
      'Objetivo da abordagem: {{outreach_goal}}.',
      'Tom de voz: {{tone}}. Seja breve, relevante e respeitoso — nunca soe como spam.',
      'Capture o interesse, registre os dados do contato e marque-o com a tag adequada.',
    ].join('\n'),
    defaultTools: ['query_contact', 'update_contact', 'add_contact_tag'],
    questions: [
      Q_BUSINESS_NAME,
      Q_TONE,
      {
        key: 'outreach_goal',
        label: 'Objetivo do outreach',
        type: 'textarea',
        required: true,
        help: 'O que esse primeiro contato deve alcançar (agendar demo, validar interesse, etc.).',
      },
    ],
  },
  {
    key: 'follow_up',
    name: 'Follow Up',
    category: 'Comercial',
    description: 'Agente de follow-up que reengaja contatos inativos e tenta avançar a negociação.',
    promptTemplate: [
      'Você faz follow-up de contatos da {{business_name}}.',
      'Reengaje de forma leve, relembrando o contexto da última interação.',
      'Tom de voz: {{tone}}.',
      'Cadência de follow-up: {{follow_up_cadence}}.',
      'Ofereça agendar uma conversa quando houver interesse; se o contato não quiser prosseguir, encerre cordialmente.',
    ].join('\n'),
    defaultTools: ['query_contact', 'update_contact', 'schedule_event', 'mark_resolved'],
    questions: [
      Q_BUSINESS_NAME,
      Q_TONE,
      {
        key: 'follow_up_cadence',
        label: 'Cadência de follow-up',
        type: 'text',
        required: false,
        help: 'Ex.: até 3 tentativas, espaçadas em 2 dias.',
      },
    ],
  },
];

/**
 * Seed idempotente do catálogo global de agent templates + suas questions.
 * Re-rodar atualiza o conteúdo sem duplicar (ids estáveis + upsert por chave única).
 */
export async function seedAgentTemplates(db: DB): Promise<void> {
  const templateRows: AgentTemplateInsert[] = TEMPLATES.map((t) => ({
    id: TEMPLATE_IDS[t.key],
    workspaceId: null,
    key: t.key,
    name: t.name,
    category: t.category,
    description: t.description,
    promptTemplate: t.promptTemplate,
    defaultModel: DEFAULT_MODEL,
    defaultModelParams: { temperature: 0.4 },
    defaultTools: t.defaultTools,
    isGlobal: true,
    updatedAt: new Date(),
  }));

  const questionRows: AgentTemplateQuestionInsert[] = TEMPLATES.flatMap((t) =>
    t.questions.map((q, position) => ({
      id: uuidv5(`${TEMPLATE_IDS[t.key]}:${q.key}`, QUESTION_NS),
      templateId: TEMPLATE_IDS[t.key],
      key: q.key,
      label: q.label,
      type: q.type,
      required: q.required,
      help: q.help ?? null,
      options: q.options ?? [],
      position,
    })),
  );

  // Conflito ancorado no PK `id` (estável e determinístico): único anchor 100%
  // confiável. A unique `(workspace_id, key)` NÃO serve para upsert aqui — em
  // Postgres NULLs são distintos, então ON CONFLICT nessa constraint não casaria
  // a linha global existente (workspace_id IS NULL) e colidiria no PK no re-run.
  await db
    .insert(agentTemplates)
    .values(templateRows)
    .onConflictDoUpdate({
      target: agentTemplates.id,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        description: sql`excluded.description`,
        promptTemplate: sql`excluded.prompt_template`,
        defaultModel: sql`excluded.default_model`,
        defaultModelParams: sql`excluded.default_model_params`,
        defaultTools: sql`excluded.default_tools`,
        isGlobal: sql`excluded.is_global`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  await db
    .insert(agentTemplateQuestions)
    .values(questionRows)
    .onConflictDoUpdate({
      target: agentTemplateQuestions.id,
      set: {
        label: sql`excluded.label`,
        type: sql`excluded.type`,
        required: sql`excluded.required`,
        help: sql`excluded.help`,
        options: sql`excluded.options`,
        position: sql`excluded.position`,
      },
    });

  console.log(
    `[db] seed agent_templates ok — ${templateRows.length} templates, ${questionRows.length} questions`,
  );
}
