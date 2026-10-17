/**
 * `/api/copilot/memory*` — dono: F73-S11 (perfil e fatos da memória).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/memory...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotMemoryRouter(): Router {
  return Router();
}
