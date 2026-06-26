/**
 * Rotas de Backup & Restauração de Flows (F50-S04). Gated por `flow.backup` (ADMINS), sob RLS.
 *
 *   GET  /api/flows/backup/export   → BackupEnvelope (download)            (flow.backup)
 *   POST /api/flows/backup/preview  → PreviewResult (sem escrita)          (flow.backup)
 *   POST /api/flows/backup/import   → ImportResult (cria flows draft)      (flow.backup)
 *
 * Montado ANTES do CRUD `/api/flows/:id` (precedência das rotas literais). O parser JSON
 * dedicado (limite maior) para import/preview é registrado em `app.ts` antes do json global.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { backupEnvelopeSchema } from '@hm/flow-engine';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  applyImport,
  buildExportBundle,
  createBackupDbPort,
  previewImport,
  verifyChecksum,
  type BackupAuthContext,
} from '../../services/flow-backup';

const exportQuerySchema = z.object({
  ids: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).optional()),
});

const previewBodySchema = z.object({ envelope: z.unknown() });
const importBodySchema = z.object({
  envelope: z.unknown(),
  confirmedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(['add']).optional(),
});

function authCtx(req: Request): BackupAuthContext {
  return { workspaceId: req.auth!.workspace.id, memberId: req.auth!.member.id };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pré-checagem de compatibilidade antes do parse estrito (mensagem clara de versão). */
function incompatibleReason(envelope: unknown): string | null {
  if (!isRecord(envelope)) return 'Arquivo de backup inválido.';
  if (envelope['app'] !== 'leadium') return 'Este arquivo não é um backup do Leadium.';
  if (envelope['formatVersion'] !== 1)
    return `Versão de formato incompatível (esperado 1, recebido ${String(envelope['formatVersion'])}).`;
  return null;
}

export function createFlowBackupRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('flow.backup')] as const;

  // GET export — baixa o bundle de todos os flows (ou ?ids=).
  router.get('/api/flows/backup/export', ...guard, async (req: Request, res: Response) => {
    const q = exportQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: 'invalid_payload', issues: q.error.issues });
      return;
    }
    const ctx = authCtx(req);
    const envelope = await req.scoped!((tx) =>
      buildExportBundle(createBackupDbPort(tx, ctx), { flowIds: q.data.ids }),
    );
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="leadium-flows-backup-${date}.json"`);
    res.json(envelope);
  });

  // POST preview — valida + resume o conteúdo, SEM escrever.
  router.post('/api/flows/backup/preview', ...guard, async (req: Request, res: Response) => {
    const body = previewBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_payload', issues: body.error.issues });
      return;
    }
    const reason = incompatibleReason(body.data.envelope);
    if (reason) {
      res.status(422).json({ error: 'version_incompatible', message: reason });
      return;
    }
    const env = backupEnvelopeSchema.safeParse(body.data.envelope);
    if (!env.success) {
      res.status(422).json({ error: 'invalid_backup', issues: env.error.issues });
      return;
    }
    if (!verifyChecksum(env.data)) {
      res.status(422).json({ error: 'checksum_mismatch', message: 'O arquivo parece corrompido.' });
      return;
    }
    const ctx = authCtx(req);
    const result = await req.scoped!((tx) => previewImport(createBackupDbPort(tx, ctx), env.data));
    res.json(result);
  });

  // POST import — cria os flows como rascunho (aditivo). Confirma o checksum do preview.
  router.post('/api/flows/backup/import', ...guard, async (req: Request, res: Response) => {
    const body = importBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_payload', issues: body.error.issues });
      return;
    }
    const reason = incompatibleReason(body.data.envelope);
    if (reason) {
      res.status(422).json({ error: 'version_incompatible', message: reason });
      return;
    }
    const env = backupEnvelopeSchema.safeParse(body.data.envelope);
    if (!env.success) {
      res.status(422).json({ error: 'invalid_backup', issues: env.error.issues });
      return;
    }
    if (!verifyChecksum(env.data)) {
      res.status(422).json({ error: 'checksum_mismatch', message: 'O arquivo parece corrompido.' });
      return;
    }
    if (body.data.confirmedChecksum !== env.data.checksum.value) {
      res.status(422).json({
        error: 'confirmation_mismatch',
        message: 'O arquivo mudou desde a pré-visualização. Revise novamente.',
      });
      return;
    }
    const ctx = authCtx(req);
    const result = await req.scoped!((tx) =>
      applyImport(createBackupDbPort(tx, ctx), env.data, { mode: body.data.mode }),
    );
    res.json(result);
  });

  return router;
}
