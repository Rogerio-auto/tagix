/**
 * Executor de capacidade de escrita (ADR-004 §3) — PLACEHOLDER de tipo.
 *
 * O F73-S05 (motor de propostas) é dono deste contrato e o completa com
 * `resolveTargets`, `preview`, `policyCheck?`, `executeItem` e `undoItem`. Aqui só existe o
 * mínimo para os registros `act-crm` (S08) e `act-external` (S09) exportarem
 * `executors: readonly CapabilityExecutor[]` desde já, e a composição em
 * `internal/copilot/index.ts` compilar.
 */
import type { CapabilityKey } from '@hm/shared';

export interface CapabilityExecutor {
  /** Capacidade de escrita do catálogo (`CAPABILITIES`) que este executor implementa. */
  readonly capability: CapabilityKey;
}
