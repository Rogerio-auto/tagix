/**
 * `/api/copilot/sessions*` — dono: F73-S10 (sessões, mensagens com SSE, cancelar turno).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/sessions...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotSessionsRouter(): Router {
  return Router();
}
