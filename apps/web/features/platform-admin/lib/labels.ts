/**
 * Rótulos e tons de estado do painel de plataforma (F72-S08).
 *
 * A API devolve códigos (`past_due`, `OWNER`, `active`); a tela mostra palavras. Fonte
 * única para Tenants, Workspace 360 e Assinaturas — antes cada tela imprimia o código
 * cru. Puro (sem React, sem DOM): testado em `labels.test.ts`.
 *
 * Os tons são os do `Badge` do `@hm/ui` (texto em token de estado ≥4,5:1 nos dois temas).
 */
import { formatNumber } from '@/shared/lib/locale';

export type StatusTone = 'neutral' | 'brand' | 'info' | 'warning' | 'danger' | 'success';

export interface StatusLabel {
  readonly label: string;
  readonly tone: StatusTone;
}

/** Status de assinatura (`workspaces.subscription_status`). */
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'canceled', 'expired'] as const;

const SUBSCRIPTION: Record<string, StatusLabel> = {
  trial: { label: 'Em teste', tone: 'info' },
  active: { label: 'Ativa', tone: 'success' },
  past_due: { label: 'Inadimplente', tone: 'warning' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
  expired: { label: 'Expirada', tone: 'danger' },
};

/** Código desconhecido não some da tela: aparece como veio, em tom neutro. */
export function subscriptionStatus(code: string): StatusLabel {
  return SUBSCRIPTION[code] ?? { label: code, tone: 'neutral' };
}

const ROLE: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Admin',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Atendente',
  READONLY: 'Leitura',
};

/** Papel do membro no workspace. */
export function memberRole(code: string): string {
  return ROLE[code] ?? code;
}

const AGENT: Record<string, StatusLabel> = {
  active: { label: 'Ativo', tone: 'success' },
  inactive: { label: 'Inativo', tone: 'neutral' },
  draft: { label: 'Rascunho', tone: 'neutral' },
  archived: { label: 'Arquivado', tone: 'neutral' },
};

/** Status de agente IA. */
export function agentStatus(code: string): StatusLabel {
  return AGENT[code] ?? { label: code, tone: 'neutral' };
}

/**
 * Custo de IA em dólar (a OpenRouter cobra em USD). No painel de plataforma o custo é
 * legítimo: quem vê pode agir sobre ele (DS3_ADOCAO §2.7).
 */
export function usd(amount: number | null | undefined, fractionDigits = 2): string {
  // Direto no `formatNumber` (não `formatMoneyUnits`): aquele arredonda para centavos, e o
  // custo de uma execução do Playground vive abaixo de um centavo (5 casas).
  return formatNumber(amount, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Fração do teto (0–1+) → faixa de atenção. `null` = sem teto. */
export function capTone(pct: number | null | undefined): 'ok' | 'warn' | 'over' | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 1) return 'over';
  if (pct >= 0.8) return 'warn';
  return 'ok';
}

/** Iniciais para o selo de um workspace ("Clínica Aurora" → "CA"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase() || '?';
}
