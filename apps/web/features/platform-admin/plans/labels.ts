import type { FeatureKey, LimitKey } from './queries';

/** Rótulos dos limites e features de plano (Planos e Assinaturas usam os mesmos). */
export const LIMIT_LABEL: Record<LimitKey, string> = {
  max_agents: 'Agentes',
  max_channels: 'Canais',
  max_members: 'Membros',
  max_monthly_messages: 'Mensagens/mês',
  max_flows: 'Flows',
  max_knowledge_documents: 'Documentos na base',
};

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  instagram: 'Instagram',
  flows: 'Flow Builder',
  api_access: 'API pública',
  campaigns: 'Campanhas',
  calendar: 'Calendário',
  knowledge_base: 'Base de conhecimento',
};

/** O catálogo de planos é cobrado em real (AbacatePay, PAYMENTS_ABACATEPAY.md). */
export const PLAN_CURRENCY = 'BRL';
