/**
 * `/api/copilot/activity*` — dono: F73-S05 (Atividade e exportação CSV).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/activity...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotActivityRouter(): Router {
  return Router();
}
