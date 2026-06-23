/**
 * Niche Blueprint — Agências (`agency`).
 *
 * Funil lead → reunião → contrato. Agente SDR (`sales_agency`). Flows
 * POPULADOS (boas-vindas/qualificação/agendamento/recuperação) — F43-S09.
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
  flows: [
    {
      name: 'Boas-vindas ao Lead',
      description: 'Acolhe o lead e identifica o serviço de interesse.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo lead' } },
        { id: 'welcome', type: 'message', data: { text: 'Olá! Obrigado pelo contato. Somos especialistas em crescimento de marcas.' } },
        { id: 'ask_service', type: 'message', data: { text: 'Qual serviço você procura: tráfego pago, social media, branding ou site/landing?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_service' },
      ],
    },
    {
      name: 'Qualificação do Lead',
      description: 'Coleta serviço, segmento e orçamento para qualificar.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['tráfego', 'trafego', 'anúncio', 'anuncio', 'marketing', 'agência', 'agencia', 'social media', 'site'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_segment', type: 'message', data: { text: 'Qual o segmento da sua empresa e o que você quer alcançar com esse investimento?' } },
        { id: 'ask_budget', type: 'message', data: { text: 'Qual a verba que você pretende investir por mês?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Tráfego pago' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Qualificação' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_segment' },
        { id: 'e2', source: 'ask_segment', target: 'ask_budget' },
        { id: 'e3', source: 'ask_budget', target: 'tag' },
        { id: 'e4', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Agendamento de Reunião',
      description: 'Conduz o lead até agendar a reunião de diagnóstico.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'message', data: { text: 'Vamos marcar uma reunião de diagnóstico? Qual o melhor dia e horário para você?' } },
        { id: 'schedule', type: 'message', data: { text: 'Perfeito! Vou organizar a reunião de diagnóstico e já te confirmo os detalhes. 📅' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Reunião agendada' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Recuperação de Lead',
      description: 'Reengaja leads que não retornaram após a proposta.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '3d' } },
        { id: 'nudge', type: 'message', data: { text: 'Oi! Ainda quer escalar seus resultados? Posso revisar a proposta e te mostrar cases do seu segmento.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
      ],
    },
  ],
};
