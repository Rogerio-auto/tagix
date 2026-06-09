import type { DbTx } from '@hm/db';
import type { SessionContext } from '../auth/session';

// Aumenta o Request do Express com o contexto autenticado e o runner RLS-escopado.
declare global {
  namespace Express {
    interface Request {
      auth?: SessionContext;
      scoped?: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
    }
  }
}

export {};
