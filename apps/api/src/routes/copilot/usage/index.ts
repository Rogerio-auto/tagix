/**
 * `/api/copilot/usage*` — dono: F73-S15 (uso e custo).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/usage...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotUsageRouter(): Router {
  return Router();
}
