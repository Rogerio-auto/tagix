/**
 * `/api/copilot/memory*` — F73-S11 (memória do negócio; COPILOTO.md §5.2, §7 A10).
 *
 *   GET  /api/copilot/memory/profile                    copilot.use
 *   PUT  /api/copilot/memory/profile                    copilot.memory.edit (parcial; "" limpa)
 *   GET  /api/copilot/memory/facts?cursor=&limit=       copilot.use
 *   POST /api/copilot/memory/facts                      copilot.memory.edit (Ensinar)
 *   POST /api/copilot/memory/facts/:id/forget           copilot.memory.edit (vale na hora)
 *   POST /api/copilot/memory/facts/:id/restore          copilot.memory.edit (até 24 h)
 *   POST /api/copilot/memory/facts/:id/correct          copilot.memory.edit
 *   GET  /api/copilot/memory/sources                    copilot.use → { data: MemorySource[] }
 *
 * Montado por `createCopilotRouter` DEPOIS da porta `requireAuth → withRLS → copilotAvailable`
 * (sessão, RLS, 402 em só leitura, view-as e Copiloto desligado já valeram). Aqui ficam a
 * permissão fina e os códigos estáveis:
 *
 *   200 ok · 201 fato criado · 400 corpo/cursor/limite inválido
 *   403 sem permissão · 404 não existe NESTE workspace (RLS; sem oráculo cross-tenant)
 *   409 `not_active` | `not_forgotten` | `restore_window_closed` | `memory_limit`
 */
import { Router, type Request, type Response } from 'express';
import { isIP } from 'node:net';
import { z } from 'zod';
import {
  CursorSchema,
  MemoryFactBodySchema,
  MemoryProfileUpdateSchema,
  UuidSchema,
} from '@hm/shared';
import { requireRole } from '../../../middlewares/auth';
import { clientIp } from '../../../middlewares/rate-limit';
import {
  InvalidCursorError,
  MEMORY_ERROR_MESSAGES,
  MEMORY_ERROR_STATUS,
  MEMORY_FACTS_PAGE_MAX,
  addMemberFact,
  correctFact,
  forgetFact,
  listFactsPage,
  listMemorySources,
  loadProfile,
  restoreFact,
  updateProfile,
  type AuditContext,
  type MemoryFailureCode,
} from '../../../services/copilot/memory';

const FactsQuery = z
  .object({
    cursor: CursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(MEMORY_FACTS_PAGE_MAX).optional(),
  })
  .strict();

function paramId(req: Request): string | null {
  const raw = req.params['id'];
  const id = typeof raw === 'string' ? raw : '';
  return UuidSchema.safeParse(id).success ? id.toLowerCase() : null;
}

function sendFailure(res: Response, error: MemoryFailureCode): void {
  res.status(MEMORY_ERROR_STATUS[error]).json({ error, message: MEMORY_ERROR_MESSAGES[error] });
}

function invalidPayload(res: Response, issues: z.ZodIssue[]): void {
  res.status(400).json({
    error: 'invalid_payload',
    message: 'Não consegui ler o que foi enviado. Confira os campos e o tamanho dos textos.',
    issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** IP e user-agent para `audit_logs` (`ip_address` é `inet`: valor que não é IP vira null). */
function auditContext(req: Request): AuditContext {
  const ip = clientIp(req);
  return {
    ipAddress: isIP(ip) === 0 ? null : ip,
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
  };
}

export function createCopilotMemoryRouter(): Router {
  const router = Router();
  const canRead = requireRole('copilot.use');
  const canEdit = requireRole('copilot.memory.edit');

  router.get('/api/copilot/memory/profile', canRead, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const profile = await req.scoped!((tx) => loadProfile(tx, workspaceId));
    res.json(profile);
  });

  router.put('/api/copilot/memory/profile', canEdit, async (req: Request, res: Response) => {
    const body = MemoryProfileUpdateSchema.safeParse(req.body ?? {});
    if (!body.success) return invalidPayload(res, body.error.issues);
    const { workspace, member } = req.auth!;
    const audit = auditContext(req);
    const profile = await req.scoped!(async (tx) => {
      await updateProfile(tx, {
        workspaceId: workspace.id,
        memberId: member.id,
        memberName: (member.name ?? '').trim() || 'Membro da equipe',
        update: body.data,
        audit,
      });
      return loadProfile(tx, workspace.id);
    });
    res.json(profile);
  });

  router.get('/api/copilot/memory/facts', canRead, async (req: Request, res: Response) => {
    const query = FactsQuery.safeParse(req.query);
    if (!query.success) return invalidPayload(res, query.error.issues);
    try {
      const page = await req.scoped!((tx) =>
        listFactsPage(tx, {
          cursor: query.data.cursor ?? null,
          ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
        }),
      );
      res.json(page);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        res.status(400).json({ error: 'invalid_cursor', message: 'Cursor inválido.' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/copilot/memory/facts', canEdit, async (req: Request, res: Response) => {
    const body = MemoryFactBodySchema.safeParse(req.body ?? {});
    if (!body.success) return invalidPayload(res, body.error.issues);
    const { workspace, member } = req.auth!;
    const audit = auditContext(req);
    const out = await req.scoped!((tx) =>
      addMemberFact(tx, {
        workspaceId: workspace.id,
        memberId: member.id,
        memberName: (member.name ?? '').trim() || 'Membro da equipe',
        content: body.data.content,
        audit,
      }),
    );
    if (!out.ok) return sendFailure(res, out.error);
    res.status(201).json(out.value);
  });

  router.post(
    '/api/copilot/memory/facts/:id/forget',
    canEdit,
    async (req: Request, res: Response) => {
      const id = paramId(req);
      if (!id) return sendFailure(res, 'not_found');
      const { workspace, member } = req.auth!;
      const audit = auditContext(req);
      const out = await req.scoped!((tx) =>
        forgetFact(tx, { workspaceId: workspace.id, id, memberId: member.id, audit }),
      );
      if (!out.ok) return sendFailure(res, out.error);
      res.json(out.value);
    },
  );

  router.post(
    '/api/copilot/memory/facts/:id/restore',
    canEdit,
    async (req: Request, res: Response) => {
      const id = paramId(req);
      if (!id) return sendFailure(res, 'not_found');
      const { workspace, member } = req.auth!;
      const audit = auditContext(req);
      const out = await req.scoped!((tx) =>
        restoreFact(tx, { workspaceId: workspace.id, id, memberId: member.id, audit }),
      );
      if (!out.ok) return sendFailure(res, out.error);
      res.json(out.value);
    },
  );

  router.post(
    '/api/copilot/memory/facts/:id/correct',
    canEdit,
    async (req: Request, res: Response) => {
      const id = paramId(req);
      if (!id) return sendFailure(res, 'not_found');
      const body = MemoryFactBodySchema.safeParse(req.body ?? {});
      if (!body.success) return invalidPayload(res, body.error.issues);
      const { workspace, member } = req.auth!;
      const audit = auditContext(req);
      const out = await req.scoped!((tx) =>
        correctFact(tx, {
          workspaceId: workspace.id,
          id,
          memberId: member.id,
          memberName: (member.name ?? '').trim() || 'Membro da equipe',
          content: body.data.content,
          audit,
        }),
      );
      if (!out.ok) return sendFailure(res, out.error);
      res.json(out.value);
    },
  );

  router.get('/api/copilot/memory/sources', canRead, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const data = await req.scoped!((tx) => listMemorySources(tx, workspaceId));
    res.json({ data });
  });

  return router;
}
