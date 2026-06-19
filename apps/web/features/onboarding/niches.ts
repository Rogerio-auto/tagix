/**
 * Catálogo (client-side) dos 7 nichos canônicos da Leadium (F43-S05).
 *
 * Espelha o registry de Niche Blueprints de `@hm/db` (F43-S03):
 * `packages/db/src/seed/niches/blueprints/*` — mesmos rótulos pt-BR e mesma
 * pré-visualização de estágios do funil. NÃO duplica o conteúdo do blueprint
 * (apenas o que a tela precisa exibir antes de aplicar). A aplicação real roda no
 * servidor via `POST /api/onboarding/apply`.
 */
import {
  Briefcase,
  Building2,
  GraduationCap,
  Scale,
  ShoppingBag,
  Stethoscope,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { NicheKey, NicheOption, SurveyGoal } from './types';

/** Ícone por nicho (lucide). Centralizado para a UI escolher por `key`. */
export const NICHE_ICON: Record<NicheKey, LucideIcon> = {
  real_estate: Building2,
  health: Stethoscope,
  education: GraduationCap,
  solar: Sun,
  retail: ShoppingBag,
  law: Scale,
  agency: Briefcase,
};

/** Os 7 nichos, na ordem de exibição do registry (`NICHE_KEYS`). */
export const NICHE_OPTIONS: readonly NicheOption[] = [
  {
    key: 'real_estate',
    name: 'Imobiliária',
    description:
      'Captação e venda/locação de imóveis, com corretor IA que qualifica leads e agenda visitas.',
    stages: ['Novo lead', 'Qualificação', 'Visita agendada', 'Proposta', 'Fechado (ganho)', 'Perdido'],
  },
  {
    key: 'health',
    name: 'Clínicas & Saúde',
    description:
      'Captação de pacientes e agendamento de consultas, com recepção IA que faz a triagem.',
    stages: ['Novo contato', 'Triagem', 'Consulta agendada', 'Compareceu', 'Tratamento fechado', 'Não convertido'],
  },
  {
    key: 'education',
    name: 'Educação',
    description:
      'Captação de alunos e nutrição até a matrícula, com atendente IA que tira dúvidas e qualifica.',
    stages: ['Novo interessado', 'Dúvidas', 'Nutrição', 'Proposta enviada', 'Matriculado', 'Desistiu'],
  },
  {
    key: 'solar',
    name: 'Energia Solar',
    description:
      'Qualificação por conta de luz e dimensionamento, com vendedor IA que conduz até o contrato.',
    stages: ['Novo lead', 'Qualificação (conta de luz)', 'Dimensionamento', 'Proposta enviada', 'Contrato assinado', 'Perdido'],
  },
  {
    key: 'retail',
    name: 'Varejo',
    description:
      'Catálogo, negociação e recompra, com vendedor IA que atende e fecha pedidos no WhatsApp.',
    stages: ['Novo contato', 'Catálogo enviado', 'Carrinho/negociação', 'Pedido fechado', 'Recompra', 'Não comprou'],
  },
  {
    key: 'law',
    name: 'Jurídico',
    description:
      'Triagem de casos e agendamento de consultas, com assistente IA que organiza a entrada.',
    stages: ['Novo contato', 'Triagem do caso', 'Consulta agendada', 'Proposta de honorários', 'Caso aceito', 'Não aceito'],
  },
  {
    key: 'agency',
    name: 'Agências',
    description:
      'Captação de clientes e fechamento de contratos, com SDR IA que qualifica e agenda reuniões.',
    stages: ['Novo lead', 'Qualificação', 'Reunião agendada', 'Proposta enviada', 'Contrato fechado', 'Perdido'],
  },
];

/** Resolve um nicho por chave (sem `any`). */
export function getNicheOption(key: NicheKey): NicheOption {
  // NICHE_OPTIONS cobre todas as chaves de NicheKey; o `find` é total por construção.
  const found = NICHE_OPTIONS.find((o) => o.key === key);
  // Fallback defensivo (nunca deve ocorrer): primeiro nicho da lista.
  return found ?? (NICHE_OPTIONS[0] as NicheOption);
}

/**
 * Sugestão (best-effort) de nicho a partir do objetivo declarado na pesquisa.
 * É só um atalho de UX — o usuário sempre confirma/troca no passo de nicho.
 * Mantido conservador: só sugere quando há um mapeamento óbvio.
 */
export function suggestNiche(goal: SurveyGoal | undefined): NicheKey | null {
  switch (goal) {
    case 'support_faster':
      return 'health';
    case 'organize_pipeline':
      return 'agency';
    case 'sell_more':
      return 'real_estate';
    default:
      return null;
  }
}
