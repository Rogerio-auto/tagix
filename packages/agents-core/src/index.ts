/**
 * `@hm/agents-core` — lógica de policy + cost-cap de agentes IA, compartilhada
 * entre a API (`@hm/api`) e os workers (`@hm/workers`). Sem I/O de rede: lê
 * `workspace_agent_policies` + `llm_usage_logs` via `@hm/db` (RLS) e decide
 * allow/deny de orçamento. O snapshot produzido casa byte-a-byte com o
 * `PolicySnapshotSchema` de `@hm/agents-client` (contrato enviado ao runtime).
 */
export * from './policy-resolver';
export * from './cost-guard';
