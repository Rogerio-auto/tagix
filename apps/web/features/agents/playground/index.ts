/**
 * Barrel do Playground do agente (F2-S19).
 *
 * O orchestrator pluga `<AgentPlayground agentId={agentId} />` no corpo de
 * `features/agents/detail/PlaygroundTab.tsx` (S18), substituindo o placeholder
 * `EmptyState`. Ver REPORT para a edição exata.
 */
export { AgentPlayground } from './AgentPlayground';
export type {
  PlaygroundError,
  SseEvent,
  SseUsage,
  ToolCallView,
  TranscriptTurn,
} from './types';
