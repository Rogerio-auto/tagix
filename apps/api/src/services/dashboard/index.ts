/**
 * Serviço de dashboard (F8-S02). Server-driven, role-aware (DASHBOARD.md §8).
 * Superfície de composição para as rotas (routes/dashboard) e para os refresh jobs
 * (apps/workers/dashboard-refresh, que reusa o registry de métricas e as queries).
 */
export {
  METRIC_DEFINITIONS,
  METRIC_BY_KEY,
  metricsForRole,
  metricVisibleTo,
  type MetricDefinition,
  type MetricCadence,
  type MetricCategory,
  type MetricScope,
  type CardType,
} from './definitions';
export {
  loadDashboard,
  visibleMetricKeys,
  type DashboardPayload,
  type DashboardCard,
  type DashboardLayoutPreferences,
  type LoadDashboardArgs,
} from './load-dashboard';
export { drillDown, type DrillResult, type DrillArgs } from './drill-down';
export { buildAlerts, type DashboardAlert, type AlertSeverity } from './alerts';
export {
  emitDashboardMetricChanged,
  setDashboardEventPublisher,
  type DashboardEventPublisher,
} from './emit';
export * as dashboardQueries from './queries';
export { type MetricValue } from './queries';
