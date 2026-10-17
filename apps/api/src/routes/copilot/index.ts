/**
 * API pública do Copiloto (F73; COPILOTO.md §5.2).
 *
 * Toda rota `/api/copilot/*` passa pela MESMA porta, registrada aqui antes de qualquer
 * sub-router: `requireAuth → withRLS (assinatura) → copilotAvailable` (view-as, papel,
 * Copiloto desligado; `services/copilot/identity/available.ts`). Os sub-routers declaram
 * caminhos completos e as permissões finas de cada rota, e NÃO devem ser montados fora daqui.
 *
 *   me/         F73-S03   GET /me, PATCH /me/prefs
 *   settings/   F73-S03   GET e PUT /settings
 *   sessions/   F73-S10   sessões, mensagens (SSE), cancelar turno
 *   proposals/  F73-S05   propostas, confirmar, ajustar, desfazer, aprovadores
 *   activity/   F73-S05   Atividade (A8) e CSV
 *   memory/     F73-S11   perfil e fatos
 *   briefing/   F73-S12   briefing do dia
 *   autopilot/  F73-S13   regras e sugestões do piloto automático
 *   usage/      F73-S15   uso e custo
 */
import { Router } from 'express';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { copilotAvailable } from '../../services/copilot/identity/available';
import { createCopilotActivityRouter } from './activity';
import { createCopilotAutopilotRouter } from './autopilot';
import { createCopilotBriefingRouter } from './briefing';
import { createCopilotMeRouter } from './me';
import { createCopilotMemoryRouter } from './memory';
import { createCopilotProposalsRouter } from './proposals';
import { createCopilotSessionsRouter } from './sessions';
import { createCopilotSettingsRouter } from './settings';
import { createCopilotUsageRouter } from './usage';

export const COPILOT_API_PREFIX = '/api/copilot';

export function createCopilotRouter(): Router {
  const router = Router();
  router.use(COPILOT_API_PREFIX, requireAuth, withRLS, copilotAvailable);
  router.use(createCopilotMeRouter());
  router.use(createCopilotSettingsRouter());
  router.use(createCopilotSessionsRouter());
  router.use(createCopilotProposalsRouter());
  router.use(createCopilotActivityRouter());
  router.use(createCopilotMemoryRouter());
  router.use(createCopilotBriefingRouter());
  router.use(createCopilotAutopilotRouter());
  router.use(createCopilotUsageRouter());
  return router;
}
