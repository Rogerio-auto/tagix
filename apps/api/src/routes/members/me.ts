/**
 * Settings pessoais do member autenticado (F8-S06, PERMISSIONS §5.1).
 *
 * Escopo: SEMPRE o próprio member (qualquer role edita o seu) — o id vem da sessão,
 * nunca do path/body, então não há escalonamento. RLS aplicada via req.scoped.
 *
 *   PATCH  /api/members/me              perfil + preferências + notificações
 *   POST   /api/members/me/password     troca de senha (re-auth com senha atual)
 *   GET    /api/members/me/sessions     lista a(s) sessão(ões) do member
 *   DELETE /api/members/me/sessions/:id revoga sessão (encerra)
 *
 * Nota de honestidade: o contrato IAuthProvider (Supabase atrás de adapter) ainda
 * não expõe updatePassword nem enumeração de devices. Aqui:
 *  - password: re-autentica com a senha atual (provider.signIn). Persistência da
 *    nova senha depende do provider — o mock aceita; provider sem suporte responde
 *    501 honesto (não finge sucesso).
 *  - sessions: modelo de sessão é o cookie httpOnly atual (uma sessão por device).
 *    Listamos a sessão corrente; revogar = signOut (logout). Multi-device real
 *    chega quando o provider expuser enumeração — endpoint já está no contrato.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { AuthError } from '@hm/shared';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { getAuthProvider } from '../../auth/provider';
import { clearSessionCookie, publicMember, readToken } from '../../auth/session';

const { members } = schema;

const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullish(),
    phone: z.string().trim().max(40).nullish(),
    avatarUrl: z.string().trim().url().max(2000).nullish(),
    themePreference: z.enum(['dark', 'light', 'system']).optional(),
    densityPreference: z.enum(['comfortable', 'compact']).optional(),
    localeOverride: z.string().trim().max(16).nullish(),
    notificationPrefs: z
      .object({
        in_app: z.boolean(),
        email: z.boolean(),
        push: z.boolean(),
      })
      .optional(),
  })
  .strict();

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export function createMembersMeRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS] as const;

  // ─── PATCH /api/members/me ──────────────────────────────────────────────────
  router.patch('/api/members/me', ...guard, async (req: Request, res: Response) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const memberId = req.auth!.member.id;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = v;
    }
    const [updated] = await req.scoped!((tx) =>
      tx.update(members).set(patch).where(eq(members.id, memberId)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ member: publicMember(updated) });
  });

  // ─── POST /api/members/me/password ─────────────────────────────────────────
  router.post('/api/members/me/password', ...guard, async (req: Request, res: Response) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;
    const email = req.auth!.member.email;
    const provider = getAuthProvider();

    // Re-auth leve: a senha atual precisa bater (§5.1).
    try {
      await provider.signIn({ email, password: currentPassword });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(401).json({ error: 'invalid_current_password', message: 'Senha atual incorreta.' });
        return;
      }
      throw err;
    }

    // Persistência da nova senha depende do provider expor updatePassword.
    // Contrato atual (IAuthProvider) ainda não tem — resposta honesta, sem fingir.
    const maybeUpdate = (provider as { updatePassword?: (email: string, pw: string) => Promise<void> })
      .updatePassword;
    if (typeof maybeUpdate !== 'function') {
      res.status(501).json({
        error: 'password_change_unavailable',
        message: 'Troca de senha indisponível neste provedor de autenticação.',
      });
      return;
    }
    await maybeUpdate(email, newPassword);
    res.sendStatus(204);
  });

  // ─── GET /api/members/me/sessions ──────────────────────────────────────────
  // Modelo atual: sessão = cookie httpOnly corrente. Enumeração multi-device chega
  // quando o provider expuser; o contrato do endpoint já é estável.
  router.get('/api/members/me/sessions', ...guard, (req: Request, res: Response) => {
    const token = readToken(req);
    const sessions = token
      ? [
          {
            id: 'current',
            current: true,
            userAgent: req.headers['user-agent'] ?? null,
            ipAddress:
              (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
              req.socket.remoteAddress ??
              null,
            createdAt: req.auth!.member.lastSeenAt ?? null,
          },
        ]
      : [];
    res.json({ sessions });
  });

  // ─── DELETE /api/members/me/sessions/:id ───────────────────────────────────
  router.delete('/api/members/me/sessions/:id', ...guard, async (req: Request, res: Response) => {
    const token = readToken(req);
    if (token) {
      await getAuthProvider().signOut(token);
    }
    clearSessionCookie(res);
    res.sendStatus(204);
  });

  return router;
}
