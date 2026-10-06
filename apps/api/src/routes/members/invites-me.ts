/**
 * Convites pendentes para a pessoa logada (F71-S05, CONTAS_E_CONVITES §5).
 *
 *   GET /api/me/invites   convites vivos para o email da sessão (banner "você foi convidado")
 *
 * O email vem da IDENTIDADE verificada pelo provider (`req.auth.identity`), nunca do cliente.
 * A consulta é privilegiada (`listPendingByEmail`, fora da RLS: os convites são de outras
 * empresas) e devolve só o que o banner mostra — sem token, sem hash, sem quem mais foi
 * convidado. Empresas em que a pessoa já é membro ativo saem da lista.
 *
 * O aceite continua pelo link do email (`/convite/<token>`): o token é a prova de que o
 * convite chegou a esta caixa, e esta rota não o devolve.
 */
import { Router, type Request, type Response } from 'express';
import { invitesRepo, membershipsRepo } from '@hm/db';
import { requireAuth } from '../../middlewares/auth';

export function createInvitesMeRouter(): Router {
  const router = Router();

  router.get('/api/me/invites', requireAuth, async (req: Request, res: Response) => {
    const { identity } = req.auth!;
    const [pending, memberships] = await Promise.all([
      invitesRepo.listPendingByEmail(identity.email),
      membershipsRepo.listActiveByAuthUser(identity.authUserId),
    ]);
    const joined = new Set(memberships.map((m) => m.workspaceId));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      invites: pending
        .filter((invite) => !joined.has(invite.workspaceId))
        .map((invite) => ({
          id: invite.id,
          workspaceId: invite.workspaceId,
          workspaceName: invite.workspaceName,
          role: invite.role,
          inviterName: invite.inviterName,
          expiresAt: invite.expiresAt.toISOString(),
        })),
    });
  });

  return router;
}
