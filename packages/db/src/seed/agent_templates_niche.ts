/**
 * Variantes de agent_templates por nicho (F5-S15): imobiliaria + clinica.
 * Templates GLOBAIS (workspace_id IS NULL, is_global=true), mesmo padrao da F2
 * (agent_templates.ts). Habilitam move_deal_stage (F5-S08) + query_deal.
 * Idempotencia: id fixo por key; upsert por PK. Chamado por seed.ts (gap-fill).
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DB } from '../client';
import { agentTemplateQuestions, agentTemplates } from '../schema';

type AgentTemplateInsert = typeof agentTemplates.$inferInsert;
type AgentTemplateQuestionInsert = typeof agentTemplateQuestions.$inferInsert;

function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const NICHE_TEMPLATE_IDS = {
  sales_real_estate: 'a9e7c0d1-0011-4011-8011-000000000011',
  support_clinic: 'a9e7c0d1-0012-4012-8012-000000000012',
} as const;

type NicheTemplateKey = keyof typeof NICHE_TEMPLATE_IDS;
const QUESTION_NS = 'a9e7c0d1-0000-4000-8000-000000000000';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

interface QuestionSeed {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'multiselect';
  required: boolean;
  help?: string;
  options?: unknown[];
}

interface TemplateSeed {
  key: NicheTemplateKey;
  name: string;
  category: string;
  description: string;
  promptTemplate: string;
  defaultTools: string[];
  questions: QuestionSeed[];
}

const TEMPLATES: readonly TemplateSeed[] = [
  {
    key: 'sales_real_estate',
    name: 'Corretor Imobiliário',
    category: 'Imobiliária',
    description:
      'Agente que qualifica leads de imóveis, agenda visitas e move o negócio no funil imobiliário.',
    promptTemplate: [
      'Você é um corretor de imóveis da {{business_name}}, especialista em {{property_focus}}.',
      'Seu objetivo é entender o que o cliente procura (tipo de imóvel, bairro, orçamento, prazo),',
      'apresentar opções aderentes e conduzir até o agendamento de uma visita.',
      'Tom de voz: {{tone}}. Seja consultivo e transparente sobre preços e condições.',
      'Sempre consulte a base de conhecimento antes de afirmar metragem, preço ou disponibilidade.',
      'Quando o cliente demonstrar interesse real, mova o negócio para o estágio adequado e proponha a visita.',
      'Nunca prometa condições (desconto, financiamento) sem confirmação — em dúvida, transfira para um corretor humano.',
    ].join('\n'),
    defaultTools: [
      'query_contact',
      'query_deal',
      'move_deal_stage',
      'add_contact_tag',
      'search_knowledge_base',
      'schedule_event',
    ],
    questions: [
      { key: 'business_name', label: 'Nome da imobiliária', type: 'text', required: true },
      {
        key: 'property_focus',
        label: 'Foco de atuação',
        type: 'textarea',
        required: true,
        help: 'Ex.: apartamentos de alto padrão na zona sul; lançamentos; locação comercial.',
      },
      { key: 'tone', label: 'Tom de voz', type: 'text', required: false, help: 'Ex.: profissional e acolhedor.' },
      {
        key: 'visit_policy',
        label: 'Política de visitas',
        type: 'textarea',
        required: false,
        help: 'Como e quando as visitas são agendadas (horários, antecedência).',
      },
    ],
  },
  {
    key: 'support_clinic',
    name: 'Recepção de Clínica',
    category: 'Clínica',
    description:
      'Agente de recepção que faz triagem, informa sobre procedimentos e agenda consultas.',
    promptTemplate: [
      'Você é a recepção virtual da {{business_name}}, uma clínica de {{specialty}}.',
      'Acolha o paciente com empatia, entenda a necessidade e oriente sobre procedimentos e convênios.',
      'Tom de voz: {{tone}}. Horário de atendimento: {{business_hours}}.',
      'Consulte a base de conhecimento antes de informar preços, preparo de exames ou cobertura de convênio.',
      'NUNCA forneça diagnóstico, prescrição ou orientação clínica — isso é exclusivo dos profissionais de saúde.',
      'Quando o paciente quiser agendar, mova o negócio para "Consulta agendada" e confirme os dados.',
      'Em urgências ou dúvidas clínicas, oriente a procurar atendimento e transfira para um humano.',
    ].join('\n'),
    defaultTools: [
      'query_contact',
      'query_deal',
      'move_deal_stage',
      'change_conversation_status',
      'transfer_to_human',
      'search_knowledge_base',
      'schedule_event',
    ],
    questions: [
      { key: 'business_name', label: 'Nome da clínica', type: 'text', required: true },
      {
        key: 'specialty',
        label: 'Especialidades',
        type: 'textarea',
        required: true,
        help: 'Ex.: odontologia, dermatologia, fisioterapia.',
      },
      { key: 'tone', label: 'Tom de voz', type: 'text', required: false, help: 'Ex.: acolhedor e claro.' },
      {
        key: 'business_hours',
        label: 'Horário de atendimento',
        type: 'text',
        required: false,
        help: 'Ex.: seg–sex 8h–18h, sáb 8h–12h.',
      },
    ],
  },
];

export async function seedNicheAgentTemplates(db: DB): Promise<void> {
  const templateRows: AgentTemplateInsert[] = TEMPLATES.map((t) => ({
    id: NICHE_TEMPLATE_IDS[t.key],
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
      id: uuidv5(`${NICHE_TEMPLATE_IDS[t.key]}:${q.key}`, QUESTION_NS),
      templateId: NICHE_TEMPLATE_IDS[t.key],
      key: q.key,
      label: q.label,
      type: q.type,
      required: q.required,
      help: q.help ?? null,
      options: q.options ?? [],
      position,
    })),
  );

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
}

export { NICHE_TEMPLATE_IDS };
