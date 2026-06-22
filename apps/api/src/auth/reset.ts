/**
 * Redefinição de senha real (F44-S04) — substitui o mock do cliente.
 * Anti-enumeração (T3): resposta e tempo uniformes; nunca revela se o email existe.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { getAuthProvider } from './provider';
import { auditAuthEvent } from '../middlewares/rate-limit';

export const resetSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();

export const verifySchema = z.object({ token: z.string().min(1).max(4096) }).strict();

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
 * Em sucesso, promove o member de 'invited' → 'active' (libera o bloqueio duro: a
 * partir daqui resolveSession aceita a sessão). Token inválido → 400 uniforme.
 * NÃO faz auto-login: o usuário segue para /login.
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
  // Ativa o member correspondente (idempotente; sem elevar privilégio).
  const { members } = schema;
  await getDb()
    .update(members)
    .set({ status: 'active', joinedAt: new Date() })
    .where(eq(members.email, identity.email));
  await auditAuthEvent('auth.verify', req, { email: identity.email, outcome: 'verified' });
  res.status(200).json({ ok: true });
}
