/**
 * API de suporte do MEMBRO (F38-S07 / SUPPORT.md secao 2.2).
 *
 *   POST /api/support/threads                 abre um thread (subject + 1a mensagem)
 *   GET  /api/support/threads                 meus threads (workspace-scoped)
 *   GET  /api/support/threads/:id             thread + mensagens
 *   POST /api/support/threads/:id/messages    nova mensagem do membro
 *   POST /api/support/threads/:id/resolve     marca resolvido
 *
 * Tudo WORKSPACE-SCOPED via withRLS (req.scoped). assertThreadVisible (espelha
 * assertConversationVisible da F30) roda em TODO /:id/* -> 404 (nao 403) fora do
 * escopo, para nao vazar existencia (correcao IDOR). Wire em app.ts e do orchestrator.
 *
 * O relay real-time (Socket.io) e da S08: este modulo expoe o seam onSupportEvent,
 * que a S08 preenche no bootstrap; aqui so o disparamos (best-effort, pos-commit).
 */
import { Router, type Request, type Response } from 'express';
import { supportRepo, type SupportMessage, type SupportThread } from '@hm/db';
import { supportOpenThreadSchema, supportSendMessageSchema } from '@hm/shared';
import { requireAuth, withRLS } from '../middlewares/auth';

function param(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

// ─── Seam de eventos de suporte (preenchido pela S08 — real-time) ─────────────
export type SupportEvent =
  | { kind: 'thread_opened'; thread: SupportThread; message: SupportMessage }
  | { kind: 'message'; thread: SupportThread; message: SupportMessage }
  | { kind: 'thread_updated'; thread: SupportThread };

export type SupportEventHook = (event: SupportEvent) => void | Promise<void>;

const supportEventHooks: SupportEventHook[] = [];

/** Registra um hook no seam. Idempotente por referencia. Chamado no bootstrap (S08). */
export function onSupportEvent(hook: SupportEventHook): void {
  if (!supportEventHooks.includes(hook)) supportEventHooks.push(hook);
}

/** Limpa hooks (uso em testes). */
export function __resetSupportEventHooks(): void {
  supportEventHooks.length = 0;
}

async function emitSupportEvent(event: SupportEvent): Promise<void> {
  for (const hook of supportEventHooks) {
    try {
      await hook(event);
    } catch {
      // best-effort: o relay nao deve derrubar a operacao.
    }
  }
}

export function createSupportRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS] as const;

  // Abre thread: cria a thread + a 1a mensagem do membro (mesma transacao).
  router.post('/api/support/threads', ...guard, async (req: Request, res: Response) => {
    const parsed = supportOpenThreadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;

    const out = await req.scoped!(async (tx) => {
      const thread = await supportRepo.createThread(tx, {
        workspaceId,
        openedBy: memberId,
        subject: parsed.data.subject,
        priority: parsed.data.priority,
      });
      const message = await supportRepo.addMessage(tx, {
        threadId: thread.id,
        senderType: 'member',
        senderId: memberId,
        body: parsed.data.message,
      });
      return { thread, message };
    });

    await emitSupportEvent({ kind: 'thread_opened', thread: out.thread, message: out.message });
    res.status(201).json({ thread: out.thread, message: out.message });
  });

  // Lista meus threads (RLS isola por workspace).
  router.get('/api/support/threads', ...guard, async (req: Request, res: Response) => {
    const threads = await req.scoped!((tx) => supportRepo.listThreads(tx));
    res.json({ threads });
  });

  // Thread + mensagens. assertThreadVisible -> 404 fora do escopo.
  router.get('/api/support/threads/:id', ...guard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const out = await req.scoped!(async (tx) => {
      const thread = await supportRepo.assertThreadVisible(tx, id);
      if (!thread) return null;
      const messages = await supportRepo.listMessages(tx, id);
      return { thread, messages };
    });
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(out);
  });

  // Nova mensagem do membro. assertThreadVisible -> 404 fora do escopo.
  router.post('/api/support/threads/:id/messages', ...guard, async (req: Request, res: Response) => {
    const parsed = supportSendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const memberId = req.auth!.member.id;
    const out = await req.scoped!(async (tx) => {
      const thread = await supportRepo.assertThreadVisible(tx, id);
      if (!thread) return null;
      const message = await supportRepo.addMessage(tx, {
        threadId: id,
        senderType: 'member',
        senderId: memberId,
        body: parsed.data.body,
      });
      // Re-le a thread para o last_message_at atualizado no evento.
      const updated = (await supportRepo.assertThreadVisible(tx, id)) ?? thread;
      return { thread: updated, message };
    });
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await emitSupportEvent({ kind: 'message', thread: out.thread, message: out.message });
    res.status(201).json({ message: out.message });
  });

  // Resolve (membro encerra o proprio pedido).
  router.post('/api/support/threads/:id/resolve', ...guard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const out = await req.scoped!(async (tx) => {
      const visible = await supportRepo.assertThreadVisible(tx, id);
      if (!visible) return null;
      return supportRepo.resolveThread(tx, id);
    });
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await emitSupportEvent({ kind: 'thread_updated', thread: out });
    res.json({ thread: out });
  });

  return router;
}
