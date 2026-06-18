/**
 * Middleware `requireCalendarAccess` (CALENDAR.md §8 / Calendar 2.0 F37-S02).
 *
 * Aplica o ownership fino que a matriz de perms (`calendar.*`) nao expressa. A
 * fonte de verdade da visibilidade e `calendarRepo.accessibleCalendarIds` (S01),
 * que ja resolve:
 *  - calendar `workspace`  -> qualquer member do workspace.
 *  - calendar `personal`   -> o dono (owner_id); OWNER/ADMIN veem todos; SUPERVISOR
 *                             ve os pessoais dos integrantes dos times que lidera.
 *  - calendar `team`        -> membros do time (`team_members`, F8) + SUPERVISOR dos
 *                             times que lidera (NAO mais "managers" amplo).
 *
 * Este middleware so confere a pertinencia de UM calendar especifico: carrega o
 * calendar (sob RLS -> ja isolado por workspace) e checa se o id esta no conjunto
 * acessivel. Mantemos `canAccessCalendar` (puro) p/ os casos `workspace`/`personal`
 * que nao dependem de pertencer a time — usado em testes e no fast-path; a decisao
 * autoritativa do middleware passa pelo repo p/ alinhar `team`/`supervisor`.
 *
 * Roda APOS requireAuth + withRLS (precisa de req.scoped e req.auth). 404 se nao
 * existe no workspace; 403 se o member nao tem acesso aquele calendar especifico.
 */
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { calendarRepo, schema } from '@hm/db';
import type { Role } from '@hm/shared';

const { calendars } = schema;

type CalendarRow = typeof calendars.$inferSelect;

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

function paramId(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Decisao PURA de acesso para os tipos que nao dependem de pertencer a um time:
 *  - workspace -> sempre.
 *  - personal  -> dono ou ADMIN/OWNER.
 *  - team      -> NAO decidivel aqui (precisa de `team_members`); retorna false.
 *
 * Para `team`, o middleware delega a `calendarRepo.accessibleCalendarIds`.
 */
export function canAccessCalendar(calendar: CalendarRow, member: { id: string; role: Role }): boolean {
  if (calendar.type === 'workspace') return true;
  if (calendar.type === 'personal') {
    return calendar.ownerId === member.id || ADMIN_ROLES.has(member.role);
  }
  // team -> requer membership; resolvido pelo repo (accessibleCalendarIds).
  return false;
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
    const member = req.auth.member;
    const outcome = await req.scoped(async (tx) => {
      const [calendar] = await tx.select().from(calendars).where(eq(calendars.id, calendarId));
      if (!calendar) return { code: 'not_found' as const };
      // Fast-path puro p/ workspace/personal; team (e demais) via repo autoritativo.
      let allowed = canAccessCalendar(calendar, { id: member.id, role: member.role as Role });
      if (!allowed) {
        const ids = await calendarRepo.accessibleCalendarIds(tx, {
          memberId: member.id,
          role: member.role as Role,
        });
        allowed = ids.includes(calendar.id);
      }
      if (!allowed) return { code: 'forbidden' as const };
      return { code: 'ok' as const, calendar };
    });
    if (outcome.code === 'not_found') {
      res.sendStatus(404);
      return;
    }
    if (outcome.code === 'forbidden') {
      res.status(403).json({ message: 'Sem acesso a este calendário.' });
      return;
    }
    req.calendar = outcome.calendar;
    next();
  };
}
