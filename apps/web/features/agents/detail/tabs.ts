/** Definição das tabs da página de detalhe do agente (UX §2 — nav clara). */
export const AGENT_TABS = [
  { id: 'config', label: 'Config' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Conhecimento' },
  { id: 'metrics', label: 'Métricas' },
  { id: 'playground', label: 'Playground' },
] as const;

export type AgentTabId = (typeof AGENT_TABS)[number]['id'];

export const DEFAULT_TAB: AgentTabId = 'config';

/** Narrowing de um valor de query param para uma tab válida. */
export function resolveTab(raw: string | null | undefined): AgentTabId {
  return AGENT_TABS.some((t) => t.id === raw) ? (raw as AgentTabId) : DEFAULT_TAB;
}
