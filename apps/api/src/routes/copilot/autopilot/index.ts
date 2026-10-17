/**
 * `/api/copilot/autopilot*` — dono: F73-S13 (regras e sugestões do piloto automático).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/autopilot...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotAutopilotRouter(): Router {
  return Router();
}
