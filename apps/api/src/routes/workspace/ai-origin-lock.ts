/**
 * Trava de origem da IA do workspace (F70-S30).
 *
 *   GET   /api/workspace/ai-origin-lock   estado atual + última alteração (workspace.edit)
 *   PATCH /api/workspace/ai-origin-lock   liga/desliga a trava (workspace.edit)
 *
 * `workspace.edit` = OWNER/ADMIN (`ROLE_CAN`, `@hm/shared`). A trava é a configuração
 * que decide se a IA automática pode atender quem não chegou por anúncio, site ou
 * Instagram; os caminhos automáticos a leem pelo predicado único de `@hm/flow-engine`
 * (`aiOriginGateSql`), dentro do UPDATE que liga a IA.
 *
 * Auditoria: toda mudança efetiva grava `audit_logs` (`workspace.ai_origin_lock.update`)
 * com quem, quando, IP/user agent e os valores anterior e novo, NA MESMA transação do
 * UPDATE. A linha do workspace é lida com `FOR UPDATE`, então o "valor anterior" é o que
 * a mudança de fato substituiu, mesmo com dois administradores alterando ao mesmo tempo.
 * Pedido que não muda nada (valor igual) não grava auditoria e devolve `changed: false`.
 */
import { isIP } from 'node:net';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { clientIp } from '../../middlewares/rate-limit';

const { workspaces, auditLogs, members } = schema;

export const AI_ORIGIN_LOCK_AUDIT_ACTION = 'workspace.ai_origin_lock.update';

const updateSchema = z.object({ aiRequiresProvenOrigin: z.boolean() }).strict();

const auditMetadataSchema = z.object({
  previous: z.boolean(),
  next: z.boolean(),
});

export interface AiOriginLockLastChange {
  readonly at: string;
  readonly byName: string | null;
  readonly byEmail: string | null;
  readonly previous: boolean;
  readonly next: boolean;
}

export interface AiOriginLockView {
  readonly aiRequiresProvenOrigin: boolean;
  readonly lastChange: AiOriginLockLastChange | null;
}

export function createAiOriginLockRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;

  router.get('/api/workspace/ai-origin-lock', ...guard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const view = await req.scoped!(async (tx) => {
      const [ws] = await tx
        .select({ aiRequiresProvenOrigin: workspaces.aiRequiresProvenOrigin })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!ws) return null;
      const [last] = await tx
        .select({
          createdAt: auditLogs.createdAt,
          metadata: auditLogs.metadata,
          byName: members.name,
          byEmail: members.email,
        })
        .from(auditLogs)
        .leftJoin(members, eq(members.id, auditLogs.actorMemberId))
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, AI_ORIGIN_LOCK_AUDIT_ACTION),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      const meta = last ? auditMetadataSchema.safeParse(last.metadata) : null;
      const lastChange: AiOriginLockLastChange | null =
        last && meta?.success
          ? {
              at: last.createdAt.toISOString(),
              byName: last.byName ?? null,
              byEmail: last.byEmail ?? null,
              previous: meta.data.previous,
              next: meta.data.next,
            }
          : null;
      const result: AiOriginLockView = {
        aiRequiresProvenOrigin: ws.aiRequiresProvenOrigin,
        lastChange,
      };
      return result;
    });
    if (!view) {
      res.sendStatus(404);
      return;
    }
    res.json(view);
  });

  router.patch('/api/workspace/ai-origin-lock', ...guard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const next = parsed.data.aiRequiresProvenOrigin;
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    // `audit_logs.ip_address` é `inet`: um valor que não é IP derrubaria a transação.
    const ip = clientIp(req);
    const ipAddress = isIP(ip) === 0 ? null : ip;
    const userAgent = req.headers['user-agent'] ?? null;

    const outcome = await req.scoped!(async (tx) => {
      const [current] = await tx
        .select({ value: workspaces.aiRequiresProvenOrigin })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
        .for('update');
      if (!current) return null;
      const previous = current.value;
      if (previous === next) return { changed: false, previous };

      await tx
        .update(workspaces)
        .set({ aiRequiresProvenOrigin: next, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));
      await tx.insert(auditLogs).values({
        workspaceId,
        actorMemberId: memberId,
        actorType: 'member',
        action: AI_ORIGIN_LOCK_AUDIT_ACTION,
        resourceType: 'workspace',
        resourceId: workspaceId,
        metadata: { previous, next },
        ipAddress,
        userAgent,
      });
      return { changed: true, previous };
    });

    if (!outcome) {
      res.sendStatus(404);
      return;
    }
    res.json({ aiRequiresProvenOrigin: next, changed: outcome.changed, previous: outcome.previous });
  });

  return router;
}
