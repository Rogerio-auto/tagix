/**
 * Rotas de privacidade / LGPD (F10-S02) — session-authed, owner/admin.
 *
 *   POST /api/privacy/exports            cria job assíncrono de export de PII → { jobId }
 *   GET  /api/privacy/exports/:id        status do job → { status, downloadUrl? }
 *   POST /api/privacy/contacts/:id/forget anonimiza/redige PII do contato em cascata
 *                                         (síncrono) → { anonymized: true } + audit_logs
 *
 * Permissões (PERMISSIONS.md §2): export é dado administrativo do workspace →
 * `workspace.edit` (OWNER/ADMIN). Forget é exclusão dura de PII → `contact.delete`
 * (OWNER/ADMIN). Ambas negam SUPERVISOR/AGENT/READONLY. A RLS de `req.scoped` garante
 * o isolamento por workspace em todas as queries.
 *
 * O export pesado é montado pelo worker (`startPrivacyExportProcessor`); aqui só
 * enfileiramos e lemos o status (resolvendo a URL assinada quando pronto).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema, type DataExportScope } from '@hm/db';
import { createStorage, type IStorageDriver } from '@hm/storage';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { anonymizeContact, createExportJob, getExportStatus } from '../../services/privacy';

const { contacts, auditLogs } = schema;

/** Body do POST /exports — `scope` é 'workspace' OU `{ contactId }`. */
const exportBodySchema = z.object({
  scope: z.union([z.literal('workspace'), z.object({ contactId: z.string().uuid() })]),
});

function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

/** Normaliza o `scope` do body para o discriminated union do schema. */
function toScope(input: 'workspace' | { contactId: string }): DataExportScope {
  return input === 'workspace' ? { kind: 'workspace' } : { kind: 'contact', contactId: input.contactId };
}

export function createPrivacyRouter(storage: IStorageDriver = createStorage()): Router {
  const router = Router();
  // Export: dado administrativo do workspace → workspace.edit (OWNER/ADMIN).
  const exportGuard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;
  // Forget: exclusão dura de PII → contact.delete (OWNER/ADMIN).
  const forgetGuard = [requireAuth, withRLS, requireRole('contact.delete')] as const;

  // ─── POST /api/privacy/exports — cria job assíncrono ─────────────────────────
  router.post('/api/privacy/exports', ...exportGuard, async (req: Request, res: Response) => {
    const parsed = exportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues });
      return;
    }
    const scope = toScope(parsed.data.scope);
    const workspaceId = req.auth!.workspace.id;
    const requestedBy = req.auth!.member.id;

    // Se o scope for um contato, valida que existe NESTE workspace (RLS) antes de enfileirar.
    if (scope.kind === 'contact') {
      const exists = await req.scoped!(async (tx) => {
        const [row] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, scope.contactId))
          .limit(1);
        return row ?? null;
      });
      if (!exists) {
        res.status(404).json({ error: 'not_found', message: 'Contato não encontrado.' });
        return;
      }
    }

    const { jobId } = await req.scoped!((tx) =>
      createExportJob(tx, { workspaceId, requestedBy, scope }),
    );
    res.status(202).json({ jobId });
  });

  // ─── GET /api/privacy/exports/:id — status + download ────────────────────────
  router.get('/api/privacy/exports/:id', ...exportGuard, async (req: Request, res: Response) => {
    const id = paramId(req, 'id');
    if (!id || !z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: 'invalid_request', message: 'id inválido.' });
      return;
    }
    const view = await req.scoped!((tx) => getExportStatus(tx, storage, id, new Date()));
    if (!view) {
      res.status(404).json({ error: 'not_found', message: 'Job de export não encontrado.' });
      return;
    }
    res.json(view);
  });

  // ─── POST /api/privacy/contacts/:id/forget — anonimização síncrona ───────────
  router.post(
    '/api/privacy/contacts/:id/forget',
    ...forgetGuard,
    async (req: Request, res: Response) => {
      const id = paramId(req, 'id');
      if (!id || !z.string().uuid().safeParse(id).success) {
        res.status(400).json({ error: 'invalid_request', message: 'id inválido.' });
        return;
      }
      const workspaceId = req.auth!.workspace.id;
      const actorMemberId = req.auth!.member.id;
      const now = new Date();

      const result = await req.scoped!(async (tx) => {
        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, id))
          .limit(1);
        if (!contact) return null;

        const summary = await anonymizeContact(tx, workspaceId, id, now);

        // Trilha de auditoria — sob a mesma transação RLS (workspace_id casa o WITH CHECK).
        await tx.insert(auditLogs).values({
          workspaceId,
          actorMemberId,
          actorType: 'member',
          action: 'privacy.contact_forgotten',
          resourceType: 'contact',
          resourceId: id,
          metadata: {
            token: summary.token,
            conversationsAnonymized: summary.conversationsAnonymized,
            messagesRedacted: summary.messagesRedacted,
            notesRedacted: summary.notesRedacted,
            dealsRedacted: summary.dealsRedacted,
          },
        });
        return summary;
      });

      if (!result) {
        res.status(404).json({ error: 'not_found', message: 'Contato não encontrado.' });
        return;
      }
      res.json({ anonymized: true });
    },
  );

  return router;
}
