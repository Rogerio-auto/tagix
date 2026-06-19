/**
 * Niche Blueprint — Energia Solar (`solar`).
 *
 * Funil de qualificação (conta de luz / consumo) → proposta. Agente consultor
 * solar (`sales_solar`) qualifica ANTES de propor. Flows POPULADOS — F43-S09.
 */
import type { NicheBlueprint } from '../types';

export const solarBlueprint: NicheBlueprint = {
  key: 'solar',
  name: 'Energia Solar',
  industry: 'solar',
  pipeline: {
    name: 'Funil Energia Solar',
    description: 'Pipeline para qualificação e venda de sistemas fotovoltaicos.',
    customFields: [
      { key: 'monthly_bill_brl', label: 'Conta de luz mensal (R$)', type: 'currency', required: false, position: 0 },
      { key: 'consumption_kwh', label: 'Consumo mensal (kWh)', type: 'number', required: false, position: 1 },
      { key: 'property_kind', label: 'Tipo de imóvel', type: 'select', required: false, options: ['Residencial', 'Comercial', 'Rural', 'Industrial'], position: 2 },
      { key: 'roof_type', label: 'Tipo de telhado', type: 'select', required: false, options: ['Cerâmica', 'Metálico', 'Laje', 'Fibrocimento', 'Solo'], position: 3 },
      { key: 'system_value_brl', label: 'Valor do sistema (R$)', type: 'currency', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo lead', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Qualificação (conta de luz)', color: '#13C7FF', position: 1, probability: 30 },
      { name: 'Dimensionamento', color: '#FFB413', position: 2, probability: 50 },
      { name: 'Proposta enviada', color: '#9B13FF', position: 3, probability: 70 },
      { name: 'Contrato assinado', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Perdido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'sales_solar' }],
  tags: [
    { name: 'Residencial', color: '#1FFF13' },
    { name: 'Comercial', color: '#13C7FF' },
    { name: 'Rural', color: '#9B13FF' },
    { name: 'Alto consumo', color: '#FF8C13' },
    { name: 'Financiamento', color: '#FFB413' },
  ],
  conversionTypes: [
    { key: 'qualified', label: 'Lead qualificado', icon: 'check-circle', color: '#13C7FF', position: 0 },
    { key: 'proposal_sent', label: 'Proposta enviada', icon: 'file-text', color: '#9B13FF', valueRequired: true, valueLabel: 'Valor da proposta (R$)', isDefault: true, position: 1 },
    { key: 'contract_signed', label: 'Contrato assinado', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do contrato (R$)', position: 2 },
  ],
  departments: [
    { name: 'Vendas', description: 'Qualificação e proposta comercial.' },
    { name: 'Engenharia', description: 'Dimensionamento e projeto do sistema.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Para montar sua economia com energia solar, qual o valor médio da sua conta de luz?', departmentName: 'Vendas', position: 0 },
    { title: 'Pedir conta de luz', body: 'Você pode me enviar uma foto da sua conta de luz? Assim faço um dimensionamento preciso.', departmentName: 'Vendas', position: 1 },
    { title: 'Economia estimada', body: 'Com base no seu consumo, o sistema pode reduzir até 95% da sua conta. Vou preparar a proposta.', departmentName: 'Engenharia', position: 2 },
  ],
  flows: [
    {
      name: 'Boas-vindas Energia Solar',
      description: 'Acolhe o lead e introduz a economia com energia solar.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo lead' } },
        { id: 'welcome', type: 'send_message', data: { text: 'Olá! Vamos calcular quanto você pode economizar com energia solar?' } },
        { id: 'ask_bill', type: 'send_message', data: { text: 'Qual o valor médio da sua conta de luz por mês?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_bill' },
      ],
    },
    {
      name: 'Qualificação Solar',
      description: 'Coleta conta de luz, consumo e tipo de imóvel para qualificar.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['solar', 'energia', 'placa', 'placas', 'fotovoltaico', 'conta de luz', 'economia'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_consumption', type: 'send_message', data: { text: 'Você sabe seu consumo mensal em kWh? Se tiver a conta em mãos, pode me enviar uma foto.' } },
        { id: 'ask_property', type: 'send_message', data: { text: 'O imóvel é residencial, comercial, rural ou industrial?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Residencial' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Qualificação (conta de luz)' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_consumption' },
        { id: 'e2', source: 'ask_consumption', target: 'ask_property' },
        { id: 'e3', source: 'ask_property', target: 'tag' },
        { id: 'e4', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Agendamento de Visita Técnica',
      description: 'Conduz o lead até agendar a visita técnica para dimensionamento.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'send_message', data: { text: 'Para dimensionar seu sistema, qual o melhor dia e horário para a visita técnica no local?' } },
        { id: 'schedule', type: 'schedule_event', data: { title: 'Visita técnica' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Dimensionamento' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Recuperação de Lead Solar',
      description: 'Reengaja leads que não fecharam após a proposta.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '3d' } },
        { id: 'nudge', type: 'send_message', data: { text: 'Oi! Ainda quer parar de pagar caro na conta de luz? Posso revisar sua proposta e as condições de financiamento.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
      ],
    },
  ],
};
