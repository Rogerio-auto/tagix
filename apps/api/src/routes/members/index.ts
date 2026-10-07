/**
 * Ponto de montagem dos sub-routers pessoais (`/api/me/*`, `/api/members/me/*`).
 *
 * O `app.ts` monta `createMembersMeRouter()` (me.ts), que monta este router no fim. Uma
 * rota pessoal nova entra aqui com UMA linha `router.use(...)`, sem tocar no `app.ts`.
 * Cada sub-router aplica o próprio guard (`requireAuth`/`withRLS`); o app já os monta
 * depois do middleware de impersonation, então escrita sob view-as é bloqueada lá.
 */
import { Router } from 'express';
import { createInvitesMeRouter } from './invites-me';

export function createMemberSubrouters(): Router {
  const router = Router();
  router.use(createInvitesMeRouter()); // F71-S05: GET /api/me/invites
  return router;
}
