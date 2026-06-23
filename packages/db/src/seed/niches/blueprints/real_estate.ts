/**
 * Niche Blueprint — Imobiliário (`real_estate`).
 *
 * Funil de captação → visita → proposta. Agente corretor (`sales_real_estate`,
 * de `agent_templates_niche.ts`). Flows POPULADOS (boas-vindas/qualificação/
 * agendamento/recuperação) — escalonado para esta onda (F43-S03).
 */
import type { NicheBlueprint } from '../types';

export const realEstateBlueprint: NicheBlueprint = {
  key: 'real_estate',
  name: 'Imobiliária',
  industry: 'real_estate',
  pipeline: {
    name: 'Funil Imobiliário',
    description: 'Pipeline para captação e venda/locação de imóveis.',
    customFields: [
      { key: 'property_type', label: 'Tipo de imóvel', type: 'select', required: false, options: ['Apartamento', 'Casa', 'Terreno', 'Comercial'], position: 0 },
      { key: 'budget_brl', label: 'Orçamento (R$)', type: 'currency', required: false, position: 1 },
      { key: 'neighborhood', label: 'Bairro de interesse', type: 'text', required: false, position: 2 },
      { key: 'transaction', label: 'Compra ou locação', type: 'select', required: false, options: ['Compra', 'Locação'], position: 3 },
      { key: 'visit_date', label: 'Data da visita', type: 'date', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo lead', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Qualificação', color: '#13C7FF', position: 1, probability: 25 },
      { name: 'Visita agendada', color: '#FFB413', position: 2, probability: 50 },
      { name: 'Proposta', color: '#9B13FF', position: 3, probability: 75 },
      { name: 'Fechado (ganho)', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Perdido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'sales_real_estate' }],
  tags: [
    { name: 'Comprador', color: '#1FFF13' },
    { name: 'Locação', color: '#13C7FF' },
    { name: 'Investidor', color: '#9B13FF' },
    { name: 'Primeiro imóvel', color: '#FFB413' },
    { name: 'Financiamento', color: '#FF8C13' },
  ],
  conversionTypes: [
    { key: 'visit_scheduled', label: 'Visita agendada', icon: 'calendar', color: '#FFB413', position: 0 },
    { key: 'proposal_sent', label: 'Proposta enviada', icon: 'file-text', color: '#9B13FF', valueRequired: true, valueLabel: 'Valor da proposta (R$)', position: 1 },
    { key: 'deal_closed', label: 'Negócio fechado', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do negócio (R$)', isDefault: true, position: 2 },
  ],
  departments: [
    { name: 'Vendas', description: 'Atendimento de leads de compra/venda.' },
    { name: 'Locação', description: 'Atendimento de leads de aluguel.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Bem-vindo(a). Me conta: você procura comprar ou alugar, e em qual região?', position: 0 },
    { title: 'Pedir orçamento', body: 'Para eu indicar as melhores opções, qual a faixa de orçamento que você tem em mente?', departmentName: 'Vendas', position: 1 },
    { title: 'Agendar visita', body: 'Posso agendar uma visita para você conhecer o imóvel. Qual o melhor dia e horário?', departmentName: 'Vendas', position: 2 },
    { title: 'Documentos locação', body: 'Para a locação precisamos de: RG, CPF, comprovante de renda (3x o aluguel) e comprovante de residência.', departmentName: 'Locação', position: 3 },
  ],
  flows: [
    {
      name: 'Boas-vindas Imobiliária',
      description: 'Saudação inicial e captura do interesse (compra/locação).',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo lead' } },
        { id: 'welcome', type: 'message', data: { text: 'Olá! Bem-vindo(a). Você procura comprar ou alugar?' } },
        { id: 'ask_region', type: 'message', data: { text: 'Em qual bairro ou região você tem interesse?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_region' },
      ],
    },
    {
      name: 'Qualificação de Lead Imobiliário',
      description: 'Coleta orçamento e tipo de imóvel para qualificar.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['comprar', 'alugar', 'imóvel', 'apartamento', 'casa'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_budget', type: 'message', data: { text: 'Qual a faixa de orçamento que você tem em mente?' } },
        { id: 'ask_type', type: 'message', data: { text: 'Está procurando apartamento, casa, terreno ou comercial?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Comprador' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_budget' },
        { id: 'e2', source: 'ask_budget', target: 'ask_type' },
        { id: 'e3', source: 'ask_type', target: 'tag' },
      ],
    },
    {
      name: 'Agendamento de Visita',
      description: 'Conduz o lead até marcar uma visita ao imóvel.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'message', data: { text: 'Qual o melhor dia e horário para a visita?' } },
        { id: 'schedule', type: 'message', data: { text: 'Perfeito! Vou organizar a visita ao imóvel e já te confirmo os detalhes. 📅' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Visita agendada' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Recuperação de Lead Frio',
      description: 'Reengaja leads sem resposta após a visita/proposta.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '2d' } },
        { id: 'nudge', type: 'message', data: { text: 'Oi! Ainda tem interesse no imóvel? Posso te mostrar novas opções.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
      ],
    },
  ],
};
