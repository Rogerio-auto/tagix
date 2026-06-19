/**
 * Niche Blueprint — Educação (`education`).
 *
 * Funil dúvida → matrícula. Agente consultor educacional (`sales_education`).
 * `flows: []` — serão preenchidos no F43-S09.
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
  flows: [],
};
