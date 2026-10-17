/**
 * `/api/copilot/activity*` — F73-S05 (A8; ADR-004 §7; COPILOTO.md §5.2).
 *
 *   GET /api/copilot/activity?scope=mine|all&cursor=&limit=
 *       `mine`: o que EU pedi (`copilot.use`, já garantido pela porta);
 *       `all`: o workspace inteiro, só `copilot.activity.view_all` (senão 403).
 *   GET /api/copilot/activity.csv   (`copilot.activity.view_all`; streaming, keyset)
 *
 * Montado por `createCopilotRouter` depois da porta `requireAuth → withRLS → copilotAvailable`.
 * Cursor malformado ou adulterado → 400 (nunca vira "primeira página").
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { InvalidCursorError } from '@hm/db';
import { createLogger } from '@hm/logger';
import { CursorSchema, can, type Role } from '@hm/shared';
import { requireRole } from '../../../middlewares/auth';
import {
  ACTIVITY_CSV_HEADER,
  activityCsvRow,
  listActivityPage,
} from '../../../services/copilot/proposals';
import { loadViewer } from '../proposals';

const logger = createLogger('info', { svc: '@hm/api', component: 'copilot-activity' });

/** Teto de linhas do CSV (a Atividade é de 12 meses; acima disso, filtro na tela). */
export const ACTIVITY_CSV_MAX_ROWS = 10_000;
const CSV_PAGE = 50;
/** BOM UTF-8 (U+FEFF) pelo código, não literal no fonte. */
const CSV_BOM = String.fromCharCode(0xfeff);

const activityQuery = z
  .object({
    scope: z.enum(['mine', 'all']).default('mine'),
    cursor: CursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

function invalidCursor(res: Response): void {
  res.status(400).json({ error: 'invalid_cursor', message: 'Cursor inválido.' });
}

/** Espera o buffer do socket esvaziar (backpressure do streaming). */
function drained(res: Response): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

export function createCopilotActivityRouter(): Router {
  const router = Router();

  router.get('/api/copilot/activity', async (req: Request, res: Response) => {
    const query = activityQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'invalid_query', message: 'Parâmetros inválidos.' });
      return;
    }
    const { scope, cursor, limit } = query.data;
    const role = req.auth!.member.role as Role;
    if (scope === 'all' && !can(role, 'copilot.activity.view_all')) {
      res
        .status(403)
        .json({ error: 'forbidden', message: 'Sem permissão para ver a atividade de todos.' });
      return;
    }
    try {
      const out = await req.scoped!(async (tx) => {
        const viewer = await loadViewer(req, tx);
        if (!viewer) return null;
        const { page } = await listActivityPage(
          tx,
          viewer,
          { scope, cursor: cursor ?? null, ...(limit !== undefined ? { limit } : {}) },
          new Date(),
        );
        return page;
      });
      if (!out) {
        res.status(403).json({ error: 'forbidden', message: 'Sem permissão para esta ação.' });
        return;
      }
      res.status(200).json(out);
    } catch (err) {
      if (err instanceof InvalidCursorError) return invalidCursor(res);
      throw err;
    }
  });

  router.get(
    '/api/copilot/activity.csv',
    requireRole('copilot.activity.view_all'),
    async (req: Request, res: Response) => {
      const scoped = req.scoped!;
      const viewer = await scoped((tx) => loadViewer(req, tx));
      if (!viewer) {
        res.status(403).json({ error: 'forbidden', message: 'Sem permissão para esta ação.' });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="copiloto-atividade-${stamp}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      // BOM: o Excel abre UTF-8 com acentos certos.
      res.write(`${CSV_BOM}${ACTIVITY_CSV_HEADER.join(',')}\r\n`);

      let cursor: string | null = null;
      let written = 0;
      try {
        while (written < ACTIVITY_CSV_MAX_ROWS && !res.destroyed) {
          const { raw, names } = await scoped((tx) =>
            listActivityPage(tx, viewer, { scope: 'all', cursor, limit: CSV_PAGE }, new Date()),
          );
          const lines = raw.items
            .slice(0, ACTIVITY_CSV_MAX_ROWS - written)
            .map((row) => `${activityCsvRow(row, names)}\r\n`);
          written += lines.length;
          if (lines.length > 0 && !res.write(lines.join(''))) await drained(res);
          cursor = raw.nextCursor;
          if (!cursor) break;
        }
      } catch (err) {
        // O status já saiu: registra e fecha. Nunca stack nem dado ao cliente.
        logger.error('copilot-activity: falha no CSV', {
          ref: 'hm_copilot_activity_csv',
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
      res.end();
    },
  );

  return router;
}
