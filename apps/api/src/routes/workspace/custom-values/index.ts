/**
 * CRUD de valores personalizados do workspace (F59-S07 — AGENCIA_PLAN.md §3.4).
 *
 * `secret` **nunca** volta na resposta — só `hasValue`. É a mesma disciplina dos
 * secrets de canal: o valor entra, é cifrado, e sai apenas para o motor de
 * renderização, nunca para a rede.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CUSTOM_VALUE_KEY_PATTERN, customValuesRepo, withWorkspace } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../../middlewares/auth';

const keySchema = z
  .string()
  .regex(
    CUSTOM_VALUE_KEY_PATTERN,
    'A chave deve começar por letra minúscula e conter apenas letras, números e _ (2 a 49 caracteres).',
  );

const upsertSchema = z.object({
  key: keySchema,
  label: z.string().min(1).max(120),
  value: z.string().max(4000),
  kind: z.enum(['text', 'url', 'secret']).default('text'),
  description: z.string().max(500).nullish(),
});

/** URL é validada aqui, na borda, e não no banco: formato muda, dado fica. */
function validateKind(input: z.infer<typeof upsertSchema>): string | null {
  if (input.kind !== 'url') return null;
  const parsed = z.string().url().safeParse(input.value);
  return parsed.success ? null : 'Valor precisa ser uma URL válida quando o tipo é "url".';
}

export function customValuesRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    withRLS,
    requireRole('workspace.edit'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const values = await withWorkspace(workspaceId, (tx) =>
        customValuesRepo.list(tx, workspaceId),
      );
      res.json({ values });
    },
  );

  router.put(
    '/:key',
    requireAuth,
    withRLS,
    requireRole('workspace.edit'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const parsed = upsertSchema.safeParse({ ...req.body, key: req.params['key'] });
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_custom_value',
          message: parsed.error.issues[0]?.message ?? 'Payload inválido.',
        });
        return;
      }

      const kindError = validateKind(parsed.data);
      if (kindError !== null) {
        res.status(400).json({ error: 'invalid_custom_value', message: kindError });
        return;
      }

      await withWorkspace(workspaceId, (tx) =>
        customValuesRepo.upsert(tx, { workspaceId, ...parsed.data }),
      );


      res.status(204).end();
    },
  );

  router.delete(
    '/:key',
    requireAuth,
    withRLS,
    requireRole('workspace.edit'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const key = keySchema.safeParse(req.params['key']);
      if (!key.success) {
        res.status(400).json({ error: 'invalid_custom_value', message: 'Chave inválida.' });
        return;
      }

      await withWorkspace(workspaceId, (tx) =>
        customValuesRepo.remove(tx, workspaceId, key.data),
      );


      res.status(204).end();
    },
  );

  return router;
}
