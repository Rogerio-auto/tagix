/**
 * Niche Blueprint — Jurídico (`law`).
 *
 * Funil triagem de caso → consulta. Agente de triagem (`triage_law`): NÃO presta
 * aconselhamento jurídico, respeita LGPD, coleta dados do caso e encaminha.
 * Flows POPULADOS — escalonado nesta onda (F43-S03).
 */
import type { NicheBlueprint } from '../types';

export const lawBlueprint: NicheBlueprint = {
  key: 'law',
  name: 'Jurídico',
  industry: 'law',
  pipeline: {
    name: 'Funil Jurídico',
    description: 'Pipeline para triagem de casos e onboarding de clientes.',
    customFields: [
      { key: 'case_area', label: 'Área do direito', type: 'select', required: false, options: ['Trabalhista', 'Cível', 'Família', 'Criminal', 'Tributário', 'Empresarial', 'Previdenciário'], position: 0 },
      { key: 'case_summary', label: 'Resumo do caso', type: 'text', required: false, position: 1 },
      { key: 'urgency', label: 'Urgência', type: 'select', required: false, options: ['Baixa', 'Média', 'Alta'], position: 2 },
      { key: 'consult_date', label: 'Data da consulta', type: 'date', required: false, position: 3 },
      { key: 'estimated_fee_brl', label: 'Honorários estimados (R$)', type: 'currency', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo contato', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Triagem do caso', color: '#13C7FF', position: 1, probability: 30 },
      { name: 'Consulta agendada', color: '#FFB413', position: 2, probability: 55 },
      { name: 'Proposta de honorários', color: '#9B13FF', position: 3, probability: 75 },
      { name: 'Caso aceito', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Não aceito', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'triage_law' }],
  tags: [
    { name: 'Trabalhista', color: '#1FFF13' },
    { name: 'Cível', color: '#13C7FF' },
    { name: 'Família', color: '#9B13FF' },
    { name: 'Criminal', color: '#FF4136' },
    { name: 'Urgente', color: '#FF8C13' },
  ],
  conversionTypes: [
    { key: 'consult_scheduled', label: 'Consulta agendada', icon: 'calendar', color: '#FFB413', position: 0 },
    { key: 'proposal_sent', label: 'Proposta enviada', icon: 'file-text', color: '#9B13FF', valueRequired: true, valueLabel: 'Honorários (R$)', position: 1 },
    { key: 'case_accepted', label: 'Caso aceito', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor do contrato (R$)', isDefault: true, position: 2 },
  ],
  departments: [
    { name: 'Triagem', description: 'Recepção e qualificação inicial de casos.' },
    { name: 'Advocacia', description: 'Atendimento jurídico pelos advogados.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Para te direcionar ao advogado certo, pode me contar resumidamente sobre o seu caso?', departmentName: 'Triagem', position: 0 },
    { title: 'LGPD', body: 'As informações que você compartilhar são tratadas com sigilo e segundo a LGPD, apenas para o seu atendimento.', departmentName: 'Triagem', position: 1 },
    { title: 'Agendar consulta', body: 'Posso agendar uma consulta com um de nossos advogados. Qual o melhor dia e horário?', departmentName: 'Advocacia', position: 2 },
    { title: 'Sem aconselhamento', body: 'Não consigo dar uma orientação jurídica por aqui, mas um advogado vai analisar seu caso na consulta.', departmentName: 'Triagem', position: 3 },
  ],
  flows: [
    {
      name: 'Boas-vindas Jurídico',
      description: 'Acolhe o contato e informa sobre sigilo/LGPD.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo contato' } },
        { id: 'welcome', type: 'message', data: { text: 'Olá! Bem-vindo(a). Suas informações são tratadas com sigilo e segundo a LGPD.' } },
        { id: 'ask_case', type: 'message', data: { text: 'Pode me contar resumidamente sobre o seu caso?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_case' },
      ],
    },
    {
      name: 'Triagem de Caso',
      description: 'Classifica a área e a urgência — sem aconselhar.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['processo', 'advogado', 'direito', 'consulta', 'caso'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_area', type: 'message', data: { text: 'Sua questão é trabalhista, cível, de família, criminal, tributária ou outra?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Trabalhista' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Triagem do caso' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_area' },
        { id: 'e2', source: 'ask_area', target: 'tag' },
        { id: 'e3', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Agendamento de Consulta Jurídica',
      description: 'Marca a consulta com um advogado.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'message', data: { text: 'Qual o melhor dia e horário para a consulta com o advogado?' } },
        { id: 'schedule', type: 'message', data: { text: 'Perfeito! Vou organizar sua consulta jurídica e já te confirmo os detalhes. 📅' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Consulta agendada' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Recuperação de Caso',
      description: 'Reengaja contatos que não retornaram após a triagem.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '3d' } },
        { id: 'nudge', type: 'message', data: { text: 'Olá! Ainda quer dar andamento ao seu caso? Posso agendar a consulta.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
      ],
    },
  ],
};
