/**
 * `/api/copilot/briefing*` — dono: F73-S12 (briefing do dia).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/briefing...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotBriefingRouter(): Router {
  return Router();
}
