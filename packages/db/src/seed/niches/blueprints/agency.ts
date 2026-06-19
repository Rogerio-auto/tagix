/**
 * Niche Blueprint — Agências (`agency`).
 *
 * Funil lead → reunião → contrato. Agente SDR (`sales_agency`). `flows: []` —
 * serão preenchidos no F43-S09.
 */
import type { NicheBlueprint } from '../types';

export const agencyBlueprint: NicheBlueprint = {
  key: 'agency',
  name: 'Agências',
  industry: 'agency',
  pipeline: {
    name: 'Funil de Aquisição (Agência)',
    description: 'Pipeline para captação de clientes e fechamento de contratos.',
    customFields: [
      { key: 'service', label: 'Serviço de interesse', type: 'select', required: false, options: ['Tráfego pago', 'Social media', 'Branding', 'Site/landing', 'SEO', 'Consultoria'], position: 0 },
      { key: 'segment', label: 'Segmento do cliente', type: 'text', required: false, position: 1 },
      { key: 'budget_brl', label: 'Verba mensal (R$)', type: 'currency', required: false, position: 2 },
      { key: 'meeting_date', label: 'Data da reunião', type: 'date', required: false, position: 3 },
      { key: 'contract_value_brl', label: 'Valor do contrato (R$)', type: 'currency', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo lead', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Qualificação', color: '#13C7FF', position: 1, probability: 25 },
      { name: 'Reunião agendada', color: '#FFB413', position: 2, probability: 50 },
      { name: 'Proposta enviada', color: '#9B13FF', position: 3, probability: 75 },
      { name: 'Contrato fechado', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Perdido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'sales_agency' }],
  tags: [
    { name: 'Tráfego pago', color: '#1FFF13' },
    { name: 'Social media', color: '#13C7FF' },
    { name: 'Branding', color: '#9B13FF' },
    { name: 'Indicação', color: '#FFB413' },
    { name: 'Recorrente', color: '#FF8C13' },
  ],
  conversionTypes: [
    { key: 'meeting_scheduled', label: 'Reunião agendada', icon: 'calendar', color: '#FFB413', position: 0 },
    { key: 'proposal_sent', label: 'Proposta enviada', icon: 'file-text', color: '#9B13FF', valueRequired: true, valueLabel: 'Valor da proposta (R$)', position: 1 },
    { key: 'contract_closed', label: 'Contrato fechado', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do contrato (R$)', isDefault: true, position: 2 },
  ],
  departments: [
    { name: 'Novos negócios', description: 'Prospecção e fechamento de novos clientes.' },
    { name: 'Atendimento', description: 'Gestão de contas e clientes ativos.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Obrigado pelo contato. Qual serviço você procura: tráfego, social media, branding ou site?', departmentName: 'Novos negócios', position: 0 },
    { title: 'Qualificação', body: 'Para montar a melhor proposta, qual o segmento da sua empresa e a verba que pretende investir por mês?', departmentName: 'Novos negócios', position: 1 },
    { title: 'Agendar reunião', body: 'Vamos marcar uma reunião de diagnóstico? Me passa um dia e horário que funcione para você.', departmentName: 'Novos negócios', position: 2 },
  ],
  flows: [],
};
