/**
 * Middleware `requireCalendarAccess` (CALENDAR.md §8).
 *
 * Aplica o ownership fino que a matriz de perms (`calendar.*`) nao expressa:
 *  - calendar `workspace`  -> qualquer member do workspace.
 *  - calendar `personal`   -> o dono (owner_id) ou ADMIN/OWNER.
 *  - calendar `team`       -> MANAGERS (OWNER/ADMIN/SUPERVISOR). O modelo de
 *                            membership de team ainda nao existe no schema (entra
 *                            em F1+); ate la, restringe a managers.
 *
 * Roda APOS requireAuth + withRLS (precisa de req.scoped e req.auth). Carrega o
 * calendar pelo :id (sob RLS -> ja isolado por workspace) e o anexa em
 * req.calendar para o handler reusar. 404 se nao existe no workspace; 403 se o
 * member nao tem acesso aquele calendar especifico.
 */
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Role } from '@hm/shared';

const { calendars } = schema;

type CalendarRow = typeof calendars.$inferSelect;

const MANAGER_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN', 'SUPERVISOR']);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

function paramId(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export function canAccessCalendar(calendar: CalendarRow, member: { id: string; role: Role }): boolean {
  if (calendar.type === 'workspace') return true;
  if (calendar.type === 'team') return MANAGER_ROLES.has(member.role);
  // personal
  return calendar.ownerId === member.id || ADMIN_ROLES.has(member.role);
}

/**
 * @param key nome do param de rota que carrega o calendarId (default 'id').
 */
export function requireCalendarAccess(key = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth || !req.scoped) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    const calendarId = paramId(req, key);
    if (!calendarId) {
      res.status(400).json({ error: 'invalid_payload', message: 'calendarId ausente.' });
      return;
    }
    const [calendar] = await req.scoped((tx) =>
      tx.select().from(calendars).where(eq(calendars.id, calendarId)),
    );
    if (!calendar) {
      res.sendStatus(404);
      return;
    }
    const member = req.auth.member;
    if (!canAccessCalendar(calendar, { id: member.id, role: member.role as Role })) {
      res.status(403).json({ message: 'Sem acesso a este calendário.' });
      return;
    }
    req.calendar = calendar;
    next();
  };
}
