/**
 * Redefinição de senha real (F44-S04) — substitui o mock do cliente.
 * Anti-enumeração (T3): resposta e tempo uniformes; nunca revela se o email existe.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { getAuthProvider } from './provider';
import { isUuid } from './session';
import { strongPassword } from './signup';
import { auditAuthEvent } from '../middlewares/rate-limit';

export const resetSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();

export const verifySchema = z.object({ token: z.string().min(1).max(4096) }).strict();

export const confirmResetSchema = z
  .object({ token: z.string().min(1).max(4096), password: strongPassword })
  .strict();

/** POST /auth/reset — sempre 200 uniforme (anti-enumeração). */
export async function resetHandler(req: Request, res: Response): Promise<void> {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Email inválido.' });
    return;
  }
  // requestPasswordReset sempre resolve (provider engole erro/email inexistente).
  await getAuthProvider().requestPasswordReset(parsed.data.email);
  await auditAuthEvent('auth.reset_requested', req, { email: parsed.data.email });
  res.status(200).json({ ok: true });
}

/**
 * POST /auth/verify — confirma o email a partir do token do link.
 * Em sucesso, promove a linha `invited` da PESSOA confirmada → `active` (libera o
 * bloqueio duro: a partir daqui resolveSession aceita a sessão). Token inválido → 400
 * uniforme. NÃO faz auto-login: o usuário segue para /login.
 *
 * A5/T6 (F71-S03): a promoção é por `auth_user_id`, NUNCA por email — antes, toda linha
 * com o email era ativada, em qualquer empresa e status (reativava removido/bloqueado).
 * Só a linha `invited`, OWNER, sem `invited_by` (o dono que o signup provisionou e que
 * aguarda a confirmação) é promovida; `inactive`/`blocked` ficam como estão, e convite de
 * outra empresa entra pelo aceite (`member_invites`), não por aqui.
 */
export async function verifyHandler(req: Request, res: Response): Promise<void> {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Token inválido.' });
    return;
  }
  const identity = await getAuthProvider().verifyEmailToken(parsed.data.token);
  if (!identity) {
    await auditAuthEvent('auth.verify', req, { outcome: 'invalid_token' });
    res.status(400).json({ message: 'Link inválido ou expirado.' });
    return;
  }
  // Ativa SÓ o dono pendente desta pessoa (idempotente; sem elevar privilégio).
  const { members } = schema;
  const promoted = isUuid(identity.authUserId)
    ? await getDb()
        .update(members)
        .set({ status: 'active', joinedAt: new Date() })
        .where(
          and(
            eq(members.authUserId, identity.authUserId),
            eq(members.status, 'invited'),
            eq(members.role, 'OWNER'),
            isNull(members.invitedBy),
          ),
        )
        .returning({ id: members.id })
    : [];
  await auditAuthEvent('auth.verify', req, {
    email: identity.email,
    outcome: 'verified',
    promoted: promoted.length,
  });
  res.status(200).json({ ok: true });
}

/**
 * POST /auth/reset/confirm — valida o token de recuperação do link e define a nova
 * senha (server-side, via provider). Token inválido/expirado → 400 uniforme. NÃO faz
 * auto-login: o usuário segue para /login com a senha nova. A senha nunca é logada (T6).
 */
export async function confirmResetHandler(req: Request, res: Response): Promise<void> {
  const parsed = confirmResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Dados inválidos. Confira a senha e tente de novo.' });
    return;
  }
  const ok = await getAuthProvider().confirmPasswordReset(parsed.data.token, parsed.data.password);
  if (!ok) {
    await auditAuthEvent('auth.reset_confirmed', req, { outcome: 'invalid_token' });
    res.status(400).json({ message: 'Link inválido ou expirado. Solicite um novo.' });
    return;
  }
  await auditAuthEvent('auth.reset_confirmed', req, { outcome: 'reset' });
  res.status(200).json({ ok: true });
}
