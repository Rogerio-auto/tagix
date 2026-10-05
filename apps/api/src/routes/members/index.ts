/**
 * Ponto de montagem dos sub-routers pessoais (`/api/me/*`, `/api/members/me/*`).
 *
 * O `app.ts` monta `createMembersMeRouter()` (me.ts), que monta este router no fim. Uma
 * rota pessoal nova entra aqui com UMA linha `router.use(...)`, sem tocar no `app.ts`.
 * Cada sub-router aplica o próprio guard (`requireAuth`/`withRLS`); o app já os monta
 * depois do middleware de impersonation, então escrita sob view-as é bloqueada lá.
 */
import { Router } from 'express';

export function createMemberSubrouters(): Router {
  const router = Router();
  // F71-S05: router.use(createInvitesMeRouter());  // GET /api/me/invites (invites-me.ts)
  return router;
}
