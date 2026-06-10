/**
 * Catalogo (client-side) dos nichos canonicos do MVP (F5-S15). Espelha as
 * definicoes de seed de packages/db/src/seed/pipeline_templates.ts. Apenas
 * imobiliaria + clinica no MVP (decisao ROADMAP).
 */
import type { NicheOption } from './types';

export const NICHE_OPTIONS: readonly NicheOption[] = [
  {
    key: 'real_estate',
    name: 'Imobiliária',
    description:
      'Funil de captação e venda/locação de imóveis, com corretor IA que qualifica leads e agenda visitas.',
    agentTemplateKey: 'sales_real_estate',
    stages: ['Novo lead', 'Qualificação', 'Visita agendada', 'Proposta', 'Fechado (ganho)', 'Perdido'],
  },
  {
    key: 'clinic',
    name: 'Clínica',
    description:
      'Funil de captação de pacientes e agendamento de consultas, com recepção IA que faz triagem.',
    agentTemplateKey: 'support_clinic',
    stages: ['Novo contato', 'Triagem', 'Consulta agendada', 'Compareceu', 'Tratamento fechado', 'Não convertido'],
  },
];
