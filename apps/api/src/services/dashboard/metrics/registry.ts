/**
 * Registry declarativo de métricas (F55-S04). Agrega todos os módulos de métrica num
 * `Map<key, MetricModule>` e expõe os helpers de catálogo/autorização que antes viviam
 * em `definitions.ts`. **A ordem deste array é a ordem de exibição** (DASHBOARD §2) —
 * preservada idêntica ao catálogo anterior para não mudar o contrato externo.
 *
 * Adicionar um card = criar 1 módulo (def + resolve + drill?) e registrá-lo aqui. Não
 * há mais `switch` por key em lugar nenhum (load/drill despacham via este Map).
 */
import type { Role } from '@hm/shared';
import type { MetricDefinition, MetricModule } from './types';

// ── Atendimento ───────────────────────────────────────────────────────────────
import { minhasConversasAbertasMetric } from './atendimento/minhas-conversas-abertas';
import { minhaFilaPendenteMetric } from './atendimento/minha-fila-pendente';
import { aguardandoAtribuicaoMetric } from './atendimento/aguardando-atribuicao';
import { emAtendimentoIaMetric } from './atendimento/em-atendimento-ia';
import { slaVioladoHojeMetric } from './atendimento/sla-violado-hoje';
import { resolvidasHojePorMimMetric } from './atendimento/resolvidas-hoje-por-mim';
import { volumeInbound24hMetric } from './atendimento/volume-inbound-24h';
import { volumeOutbound24hMetric } from './atendimento/volume-outbound-24h';
import { inboxPorDepartamentoMetric } from './atendimento/inbox-por-departamento';
import { performancePorAtendenteMetric } from './atendimento/performance-por-atendente';
import { tempoMedioPrimeiraResposta24hMetric } from './atendimento/tempo-medio-primeira-resposta-24h';
import { tempoMedioResolucao24hMetric } from './atendimento/tempo-medio-resolucao-24h';
import { inboxPorCanalMetric } from './atendimento/inbox-por-canal';
import { transferencias24hMetric } from './atendimento/transferencias-24h';
import { satisfacaoMediaMetric } from './atendimento/satisfacao-media';
import { leaderboardProdutividadeMetric } from './atendimento/leaderboard-produtividade';
import { leadsRecentesMetric } from './atendimento/leads-recentes';
// ── Pipeline ──────────────────────────────────────────────────────────────────
import { valorTotalPipelineMetric } from './pipeline/valor-total-pipeline';
import { dealsFechadosGanhoMesMetric } from './pipeline/deals-fechados-ganho-mes';
// ── Agentes IA ────────────────────────────────────────────────────────────────
import { custoLlmHojeUsdMetric } from './agentes/custo-llm-hoje-usd';
import { custoLlmMesUsdMetric } from './agentes/custo-llm-mes-usd';
import { agenteHandoffs24hMetric } from './agentes/agente-handoffs-24h';
import { agenteResolucoes24hMetric } from './agentes/agente-resolucoes-24h';
import { latenciaAgenteP9524hMetric } from './agentes/latencia-agente-p95-24h';
import { tokensPorModelo24hMetric } from './agentes/tokens-por-modelo-24h';
import { capMensalConsumidoPctMetric } from './agentes/cap-mensal-consumido-pct';
import { qualidadeRespostaMediaMetric } from './agentes/qualidade-resposta-media';
import { qualidadePorAgenteMetric } from './agentes/qualidade-por-agente';
import { qualidadePorAtendenteMetric } from './agentes/qualidade-por-atendente';
// ── Conversões ────────────────────────────────────────────────────────────────
import { conversoesMinhasMesMetric } from './conversoes/conversoes-minhas-mes';
import { conversoesWorkspaceMesMetric } from './conversoes/conversoes-workspace-mes';
import { valorConvertidoWorkspaceMesMetric } from './conversoes/valor-convertido-workspace-mes';
import { conversoesPorTipoMetric } from './conversoes/conversoes-por-tipo';
import { conversoesPorAtendenteHumanoMetric } from './conversoes/conversoes-por-atendente-humano';
import { conversoesPorAgenteIaMetric } from './conversoes/conversoes-por-agente-ia';
// ── Negócio ───────────────────────────────────────────────────────────────────
import { novosContatosMesMetric } from './negocio/novos-contatos-mes';
import { contatosTotalWorkspaceMetric } from './negocio/contatos-total-workspace';
import { objecoesRankeadasMetric } from './negocio/objecoes-rankeadas';
import { desempenho30dMetric } from './negocio/desempenho-30d';

/**
 * Ordem canônica de implementação/exibição (§2) — idêntica ao catálogo anterior.
 * Mantida deliberadamente focada no conjunto coberto por queries reais; métricas
 * estratégicas pesadas resolvem `null` (o front não renderiza card vazio).
 */
const MODULES: readonly MetricModule[] = [
  // §2.1 Atendimento (live)
  minhasConversasAbertasMetric,
  minhaFilaPendenteMetric,
  aguardandoAtribuicaoMetric,
  emAtendimentoIaMetric,
  slaVioladoHojeMetric,
  resolvidasHojePorMimMetric,
  volumeInbound24hMetric,
  volumeOutbound24hMetric,
  inboxPorDepartamentoMetric,
  // §2.2 Pipeline
  valorTotalPipelineMetric,
  dealsFechadosGanhoMesMetric,
  // §2.4 Agentes IA
  custoLlmHojeUsdMetric,
  custoLlmMesUsdMetric,
  // §2.5 Conversões (gated por conversion_type)
  conversoesMinhasMesMetric,
  conversoesWorkspaceMesMetric,
  valorConvertidoWorkspaceMesMetric,
  conversoesPorTipoMetric,
  // §2.6 Negócio (OWNER)
  novosContatosMesMetric,
  contatosTotalWorkspaceMetric,
  // §2.1 Atendimento — performance/supervisão (Onda A)
  performancePorAtendenteMetric,
  tempoMedioPrimeiraResposta24hMetric,
  tempoMedioResolucao24hMetric,
  inboxPorCanalMetric,
  transferencias24hMetric,
  // §2.4 Agentes IA — operacional (Onda A)
  agenteHandoffs24hMetric,
  agenteResolucoes24hMetric,
  latenciaAgenteP9524hMetric,
  tokensPorModelo24hMetric,
  capMensalConsumidoPctMetric,
  // §2.5 Conversões — ranking por atendente/agente (Onda A)
  conversoesPorAtendenteHumanoMetric,
  conversoesPorAgenteIaMetric,
  // §F29 Onda B — qualidade / CSAT / objeções
  qualidadeRespostaMediaMetric,
  qualidadePorAgenteMetric,
  qualidadePorAtendenteMetric,
  satisfacaoMediaMetric,
  objecoesRankeadasMetric,
  // §F48 Command Center v2 — leaderboard / feed de leads / série 30d
  leaderboardProdutividadeMetric,
  leadsRecentesMetric,
  desempenho30dMetric,
];

/** Registry por key (lookup O(1) p/ load e drill). Falha no boot se houver key duplicada. */
const REGISTRY: ReadonlyMap<string, MetricModule> = (() => {
  const map = new Map<string, MetricModule>();
  for (const mod of MODULES) {
    if (map.has(mod.def.key)) {
      throw new Error(`[dashboard] métrica duplicada no registry: ${mod.def.key}`);
    }
    map.set(mod.def.key, mod);
  }
  return map;
})();

/** Módulo de uma métrica por key (ou `undefined`). */
export function getMetricModule(key: string): MetricModule | undefined {
  return REGISTRY.get(key);
}

/** Todos os módulos na ordem canônica de exibição. */
export const METRIC_MODULES: readonly MetricModule[] = MODULES;

/** Definições na ordem do registry (compat com o catálogo anterior). */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = MODULES.map((m) => m.def);

/** Índice de definições por key para lookup O(1). */
export const METRIC_BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(
  METRIC_DEFINITIONS.map((m) => [m.key, m]),
);

/** Uma métrica é visível para `role`? (decisão de autorização do §8). */
export function metricVisibleTo(metric: MetricDefinition, role: Role): boolean {
  return metric.roles.includes(role);
}

/**
 * Conjunto de métricas que `role` pode ver, na ordem do registry. Aplica o gate de
 * conversão: cards `requiresConversionType` só entram se `hasConversionType`.
 */
export function metricsForRole(role: Role, hasConversionType: boolean): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter(
    (m) => metricVisibleTo(m, role) && (!m.requiresConversionType || hasConversionType),
  );
}

/** Conjunto de keys que um role pode ver (sem gate de conversão) — usado em §6/§8/testes. */
export function visibleMetricKeys(role: Role): string[] {
  return METRIC_DEFINITIONS.filter((m) => m.roles.includes(role)).map((m) => m.key);
}
