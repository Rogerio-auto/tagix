/**
 * Uso, custo, alerta de orçamento e telemetria de produto do Copiloto (F73-S15).
 */
export {
  loadCopilotUsage,
  usageMonthKey,
  USAGE_TOP_MEMBERS,
  USAGE_UNNAMED_MEMBER,
  type UsageSettings,
} from './usage';
export {
  CopilotInsightsSchema,
  INSIGHTS_PERIOD_DAYS,
  INSIGHTS_WEEK_DAYS,
  loadCopilotInsights,
  type CopilotInsights,
} from './insights';
export {
  BUDGET_ALERT_DONE_PREFIX,
  BUDGET_ALERT_LOCK_PREFIX,
  BUDGET_ALERT_TICK_INTERVAL_MS,
  BUDGET_ALERT_URL,
  BUDGET_CAP_PCT,
  budgetAlertEventKey,
  createBudgetAlertDeps,
  crossedThresholds,
  runBudgetAlertTick,
  startBudgetAlertScheduler,
  type BudgetAlertDeps,
  type BudgetAlertRedis,
  type BudgetAlertScheduler,
  type BudgetAlertTickOptions,
  type BudgetAlertTickResult,
} from './budget-alert';
