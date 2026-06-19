/**
 * Niche Blueprint — Clínicas & Saúde (`health`).
 *
 * Funil triagem → consulta. Agente recepção (`support_clinic`) que NUNCA
 * diagnostica. Flows POPULADOS — escalonado nesta onda (F43-S03).
 */
import type { NicheBlueprint } from '../types';

export const healthBlueprint: NicheBlueprint = {
  key: 'health',
  name: 'Clínicas & Saúde',
  industry: 'health',
  pipeline: {
    name: 'Funil Clínica',
    description: 'Pipeline para captação de pacientes e agendamento de consultas.',
    customFields: [
      { key: 'procedure', label: 'Procedimento de interesse', type: 'text', required: false, position: 0 },
      { key: 'insurance', label: 'Convênio', type: 'text', required: false, position: 1 },
      { key: 'professional', label: 'Profissional', type: 'text', required: false, position: 2 },
      { key: 'appointment_date', label: 'Data da consulta', type: 'date', required: false, position: 3 },
      { key: 'estimated_value_brl', label: 'Valor estimado (R$)', type: 'currency', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo contato', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Triagem', color: '#13C7FF', position: 1, probability: 30 },
      { name: 'Consulta agendada', color: '#FFB413', position: 2, probability: 60 },
      { name: 'Compareceu', color: '#9B13FF', position: 3, probability: 80 },
      { name: 'Tratamento fechado', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Não convertido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'support_clinic' }],
  tags: [
    { name: 'Primeira consulta', color: '#1FFF13' },
    { name: 'Retorno', color: '#13C7FF' },
    { name: 'Convênio', color: '#9B13FF' },
    { name: 'Particular', color: '#FFB413' },
    { name: 'Urgência', color: '#FF4136' },
  ],
  conversionTypes: [
    { key: 'appointment_scheduled', label: 'Consulta marcada', icon: 'calendar', color: '#FFB413', isDefault: true, position: 0 },
    { key: 'showed_up', label: 'Compareceu', icon: 'check-circle', color: '#9B13FF', position: 1 },
    { key: 'treatment_closed', label: 'Tratamento fechado', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do tratamento (R$)', position: 2 },
  ],
  departments: [
    { name: 'Recepção', description: 'Triagem e agendamento de pacientes.' },
    { name: 'Financeiro', description: 'Convênios, orçamentos e pagamentos.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Seja bem-vindo(a). Como posso ajudar? Você gostaria de marcar uma consulta?', departmentName: 'Recepção', position: 0 },
    { title: 'Convênios aceitos', body: 'Trabalhamos com diversos convênios. Qual é o seu? Verifico a cobertura para você.', departmentName: 'Financeiro', position: 1 },
    { title: 'Agendar consulta', body: 'Posso agendar sua consulta. Qual a especialidade e o melhor dia para você?', departmentName: 'Recepção', position: 2 },
    { title: 'Preparo de exame', body: 'Vou confirmar as orientações de preparo. Um instante, por favor.', departmentName: 'Recepção', position: 3 },
  ],
  flows: [
    {
      name: 'Boas-vindas Clínica',
      description: 'Acolhe o paciente e direciona para agendamento.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo contato' } },
        { id: 'welcome', type: 'send_message', data: { text: 'Olá! Bem-vindo(a). Posso ajudar a marcar uma consulta ou tirar dúvidas.' } },
        { id: 'ask_need', type: 'send_message', data: { text: 'Qual especialidade ou procedimento você procura?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_need' },
      ],
    },
    {
      name: 'Triagem de Paciente',
      description: 'Coleta convênio e necessidade — sem orientação clínica.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['consulta', 'agendar', 'marcar', 'exame'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_insurance', type: 'send_message', data: { text: 'Você tem convênio ou será particular?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Primeira consulta' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Triagem' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_insurance' },
        { id: 'e2', source: 'ask_insurance', target: 'tag' },
        { id: 'e3', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Agendamento de Consulta',
      description: 'Marca a consulta e confirma os dados.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'send_message', data: { text: 'Qual o melhor dia e horário para sua consulta?' } },
        { id: 'schedule', type: 'schedule_event', data: { title: 'Consulta' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Consulta agendada' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Lembrete e Recuperação',
      description: 'Lembra do horário e reengaja quem não compareceu.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '1d' } },
        { id: 'reminder', type: 'send_message', data: { text: 'Lembrete: sua consulta está agendada. Confirma sua presença?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'reminder' },
      ],
    },
  ],
};
