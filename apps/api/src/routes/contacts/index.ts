/**
 * Agregador do domínio Contatos (F8-S09 + opt-in F6).
 *
 * Ordem importa: o CRUD declara rotas mais específicas (`/api/contacts/:id/tags`)
 * e o router de opt-in declara `/api/contacts/:id/opt-in` etc. — sem colisão de
 * verbo+path, então a ordem é só organizacional. Montado em app.ts.
 */
import { Router } from 'express';
import { createContactsCrudRouter } from './contacts';
import { createContactsOptInRouter } from './opt-in';

export function createContactsRouter(): Router {
  const router = Router();
  router.use(createContactsCrudRouter());
  router.use(createContactsOptInRouter());
  return router;
}

export { createContactsCrudRouter } from './contacts';
export {
  createContactsOptInRouter,
  optInContact,
  optOutContact,
  OPT_IN_METHODS,
  type OptInMethod,
  type OptInArgs,
  type OptOutArgs,
} from './opt-in';
