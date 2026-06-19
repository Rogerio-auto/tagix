/**
 * Niche Blueprint — Educação (`education`).
 *
 * Funil dúvida → matrícula. Agente consultor educacional (`sales_education`).
 * Flows POPULADOS (boas-vindas/qualificação/agendamento/recuperação) — F43-S09.
 */
import type { NicheBlueprint } from '../types';

export const educationBlueprint: NicheBlueprint = {
  key: 'education',
  name: 'Educação',
  industry: 'education',
  pipeline: {
    name: 'Funil Educacional',
    description: 'Pipeline para captação de alunos e matrículas.',
    customFields: [
      { key: 'course', label: 'Curso de interesse', type: 'text', required: false, position: 0 },
      { key: 'modality', label: 'Modalidade', type: 'select', required: false, options: ['Presencial', 'Online', 'Híbrido'], position: 1 },
      { key: 'shift', label: 'Turno', type: 'select', required: false, options: ['Manhã', 'Tarde', 'Noite'], position: 2 },
      { key: 'start_date', label: 'Início desejado', type: 'date', required: false, position: 3 },
      { key: 'tuition_brl', label: 'Mensalidade (R$)', type: 'currency', required: false, position: 4 },
    ],
    stages: [
      { name: 'Novo interessado', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Dúvidas', color: '#13C7FF', position: 1, probability: 25 },
      { name: 'Nutrição', color: '#FFB413', position: 2, probability: 45 },
      { name: 'Proposta enviada', color: '#9B13FF', position: 3, probability: 70 },
      { name: 'Matriculado', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Desistiu', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  agents: [{ templateKey: 'sales_education' }],
  tags: [
    { name: 'Graduação', color: '#1FFF13' },
    { name: 'Curso técnico', color: '#13C7FF' },
    { name: 'Curso livre', color: '#9B13FF' },
    { name: 'Bolsa', color: '#FFB413' },
    { name: 'Reingresso', color: '#FF8C13' },
  ],
  conversionTypes: [
    { key: 'visit_or_trial', label: 'Aula experimental', icon: 'calendar', color: '#FFB413', position: 0 },
    { key: 'proposal_sent', label: 'Proposta enviada', icon: 'file-text', color: '#9B13FF', valueRequired: true, valueLabel: 'Valor da mensalidade (R$)', position: 1 },
    { key: 'enrollment', label: 'Matrícula', icon: 'trophy', color: '#13FF6B', valueRequired: true, valueLabel: 'Valor da matrícula (R$)', isDefault: true, position: 2 },
  ],
  departments: [
    { name: 'Comercial', description: 'Atendimento e captação de novos alunos.' },
    { name: 'Secretaria', description: 'Matrículas, documentos e financeiro.' },
  ],
  quickReplies: [
    { title: 'Boas-vindas', body: 'Olá! Que bom seu interesse. Qual curso você gostaria de conhecer?', departmentName: 'Comercial', position: 0 },
    { title: 'Valores e bolsas', body: 'Temos opções de bolsa e parcelamento. Posso te enviar os valores do curso que você procura?', departmentName: 'Comercial', position: 1 },
    { title: 'Documentos matrícula', body: 'Para a matrícula precisamos de: RG, CPF, comprovante de residência e histórico escolar.', departmentName: 'Secretaria', position: 2 },
  ],
  flows: [
    {
      name: 'Boas-vindas ao Interessado',
      description: 'Acolhe o interessado e captura o curso desejado.',
      status: 'active',
      triggerType: 'new_lead',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Novo interessado' } },
        { id: 'welcome', type: 'send_message', data: { text: 'Olá! Que bom seu interesse na nossa instituição. Posso te ajudar a escolher o curso ideal.' } },
        { id: 'ask_course', type: 'send_message', data: { text: 'Qual curso você gostaria de conhecer?' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'welcome' },
        { id: 'e2', source: 'welcome', target: 'ask_course' },
      ],
    },
    {
      name: 'Qualificação do Aluno',
      description: 'Coleta curso, turno e objetivo para qualificar.',
      status: 'active',
      triggerType: 'keyword',
      triggerConfig: { keywords: ['curso', 'matrícula', 'matricula', 'graduação', 'graduacao', 'inscrição', 'inscricao'] },
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Palavra-chave' } },
        { id: 'ask_shift', type: 'send_message', data: { text: 'Você prefere estudar de manhã, à tarde ou à noite?' } },
        { id: 'ask_goal', type: 'send_message', data: { text: 'Qual seu objetivo: ingressar no mercado, mudar de área ou se especializar?' } },
        { id: 'tag', type: 'add_tag', data: { tag: 'Graduação' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Dúvidas' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_shift' },
        { id: 'e2', source: 'ask_shift', target: 'ask_goal' },
        { id: 'e3', source: 'ask_goal', target: 'tag' },
        { id: 'e4', source: 'tag', target: 'move' },
      ],
    },
    {
      name: 'Agendamento de Visita / Aula Experimental',
      description: 'Conduz o interessado até agendar uma visita ou aula experimental.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'ask_slot', type: 'send_message', data: { text: 'Qual o melhor dia e horário para você conhecer a escola ou fazer uma aula experimental?' } },
        { id: 'schedule', type: 'schedule_event', data: { title: 'Visita / aula experimental' } },
        { id: 'move', type: 'move_stage', data: { stage: 'Nutrição' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ask_slot' },
        { id: 'e2', source: 'ask_slot', target: 'schedule' },
        { id: 'e3', source: 'schedule', target: 'move' },
      ],
    },
    {
      name: 'Recuperação de Matrícula',
      description: 'Reengaja interessados que não concluíram a matrícula.',
      status: 'active',
      triggerType: 'manual',
      nodes: [
        { id: 'start', type: 'trigger', data: { label: 'Manual' } },
        { id: 'wait', type: 'wait', data: { duration: '2d' } },
        { id: 'nudge', type: 'send_message', data: { text: 'Oi! As vagas estão acabando. Quer garantir sua matrícula? Posso te ajudar com bolsa e parcelamento.' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'nudge' },
      ],
    },
  ],
};
