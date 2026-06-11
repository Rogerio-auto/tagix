import type { DbTx, schema } from '@hm/db';
import type { SessionContext } from '../auth/session';

// Aumenta o Request do Express com o contexto autenticado e o runner RLS-escopado.
declare global {
  namespace Express {
    interface Request {
      auth?: SessionContext;
      scoped?: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
      // Calendar (F7): requireCalendarAccess anexa o calendar resolvido (§8).
      calendar?: typeof schema.calendars.$inferSelect;
    }
  }
}

export {};
