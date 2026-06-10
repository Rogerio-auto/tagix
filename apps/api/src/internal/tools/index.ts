/**
 * Barrel do endpoint interno de tools (callback Python → Node) — F2-S07.
 *
 * O orchestrator monta `createInternalToolsRouter()` em `app.ts` (vide relatório
 * do slot): DEPOIS de `express.json()` (consome corpo JSON) e SEM `requireAuth`
 * (auth é por token interno). F2-S20 registra os handlers concretos via
 * `ToolHandlerRegistry`.
 */
export { createInternalToolsRouter } from './router';
export type { InternalToolsRouterOptions } from './router';
export {
  ToolHandlerRegistry,
  createDefaultRegistry,
  pingHandler,
} from './registry';
export type {
  ToolCallEnvelope,
  ToolHandler,
  ToolHandlerResult,
} from './registry';
export { toolCallEnvelopeSchema } from './schema';
export type { ToolCallEnvelopeInput } from './schema';
