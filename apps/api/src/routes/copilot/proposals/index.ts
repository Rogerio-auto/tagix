/**
 * `/api/copilot/proposals*` — dono: F73-S05 (propostas, confirmar, ajustar, cancelar, desfazer, aprovadores).
 *
 * Lugar reservado pelo F73-S03: `createCopilotRouter` já monta este router depois da porta
 * `requireAuth → withRLS → copilotAvailable`. Declare caminhos completos
 * (`/api/copilot/proposals...`) e a permissão fina de cada rota.
 */
import { Router } from 'express';

export function createCopilotProposalsRouter(): Router {
  return Router();
}
