/**
 * API de plataforma — inbox de suporte (F38-S10 / SUPPORT.md secao 2.2).
 *
 *   GET   /api/platform/support/threads?status=&priority=&workspace=  triagem cross-ws
 *   GET   /api/platform/support/threads/:id                           thread + mensagens
 *   POST  /api/platform/support/threads/:id/messages                  reply da equipe
 *   PATCH /api/platform/support/threads/:id                           status/priority/assign
 *
 * Cross-workspace (a equipe Leadium ve tudo) -> via supportRepo.*Platform (getDb
 * owner, bypassa RLS). TODAS as rotas gated por requirePlatformAdmin (nao-admin
 * negado 403 + auditado). Reply/patch emitem real-time (S08): membro recebe no
 * room support:thread:<id> e a triagem no support:platform. Wire em app.ts no
 * proprio app.ts (ja monta createPlatformHelpRouter via barrel — este router e
 * exportado pelo barrel platform/index.ts e montado pelo orchestrator).
 */
import { Router, type Request, type Response } from 'express';
import { getDb, schema, supportRepo } from '@hm/db';
import { supportPlatformFiltersSchema, supportPlatformPatchSchema, supportSendMessageSchema } from '@hm/shared';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { emitSupportEvent } from '../../services/support-realtime';

const { auditLogs } = schema;

function paramId(req: Request): string {
  const raw = req.params['id'];
  return typeof raw === 'string' ? raw : '';
}

async function audit(req: Request, action: string, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
  await getDb().insert(auditLogs).values({
    workspaceId: req.auth!.member.workspaceId,
    actorMemberId: req.auth!.member.id,
    actorType: 'platform_admin',
    action,
    resourceType: 'support_thread',
    resourceId,
    metadata,
  });
}

export function createPlatformSupportRouter(): Router {
  const router = Router();

  // Triagem cross-workspace com filtros.
  router.get('/api/platform/support/threads', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = supportPlatformFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const threads = await supportRepo.listThreadsPlatform(parsed.data);
    res.json({ threads });
  });

  // Thread + mensagens (qualquer workspace).
  router.get('/api/platform/support/threads/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const id = paramId(req);
    const thread = await supportRepo.findThreadByIdPlatform(id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const messages = await supportRepo.listMessagesPlatform(id);
    res.json({ thread, messages });
  });

  // Reply da equipe (sender_type=platform) + emit real-time.
  router.post('/api/platform/support/threads/:id/messages', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = supportSendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const id = paramId(req);
    const thread = await supportRepo.findThreadByIdPlatform(id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const message = await supportRepo.addMessagePlatform({
      threadId: id,
      senderType: 'platform',
      senderId: req.auth!.member.id,
      body: parsed.data.body,
    });
    const updated = (await supportRepo.findThreadByIdPlatform(id)) ?? thread;
    emitSupportEvent({ kind: 'message', thread: updated, message });
    await audit(req, 'support.platform_replied', id, {});
    res.status(201).json({ message });
  });

  // Atualiza status/priority/assign + emit real-time.
  router.patch('/api/platform/support/threads/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = supportPlatformPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const id = paramId(req);
    if (!(await supportRepo.findThreadByIdPlatform(id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const thread = await supportRepo.updateThreadPlatform(id, {
      status: parsed.data.status,
      priority: parsed.data.priority,
      assignedTo: parsed.data.assignedTo,
    });
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    emitSupportEvent({ kind: 'thread_updated', thread });
    await audit(req, 'support.platform_updated', id, {
      status: parsed.data.status ?? null,
      priority: parsed.data.priority ?? null,
    });
    res.json({ thread });
  });

  return router;
}
