/**
 * Ações da tela "Hoje" (F61-S12).
 *
 * ## Por que existe uma rota nova em vez de reusar as que já há
 *
 * Reusamos o que dá: **Depois** e **Resolver** chamam
 * `POST /api/conversations/:id/status`, que já tem guard de visibilidade,
 * permissão dinâmica (`conversation.snooze` vs `conversation.resolve`), marcos de
 * ciclo e relay de socket. Duplicar isso seria criar uma segunda verdade sobre
 * quem pode fechar conversa.
 *
 * **Perdido** é o que não existia como ação única. Hoje ele exige três chamadas:
 * garantir o card (`POST /api/conversations/:id/deal`), fechar perdido
 * (`POST /api/deals/:id/close-lost`) e resolver a conversa. Três round-trips a
 * partir de um celular no 4G, com dois estados intermediários possíveis se a
 * segunda falhar — exatamente o que a tela "Hoje" não pode fazer. Aqui é uma
 * chamada e uma transação: ou o lead vira perdido registrado, ou nada muda.
 *
 * ## Por que "Perdido" mexe no pipeline
 *
 * Um botão que só tira a linha da tela seria mentira: o lead sumiria da vista e
 * do número, sem virar aprendizado. Marcar perdido fecha o card
 * (`closed_won = false`) e grava no `deal_history` — é assim que a taxa de
 * conversão fica honesta e que o dono descobre, no fim do mês, quantos ele
 * perdeu por demora.
 */
import { Router, type Request, type Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assertConversationVisible, schema } from '@hm/db';
import { can, type Permission, type Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { ensureDealForConversation } from '../pipeline/deal-conversation';

const lostSchema = z.object({
  /** Por que se perdeu. Opcional: exigir texto faria o dono não usar o botão. */
  reason: z.string().trim().max(500).optional(),
});

/** Narrowing do `req.params[name]` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

type Resultado =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ok'; readonly dealId: string | null };

export function createTodayActionsRouter(): Router {
  const router = Router();

  /**
   * POST /api/dashboard/today/:id/lost — o lead não vai fechar.
   *
   * Uma transação: fecha o card como perdido, registra no histórico e resolve a
   * conversa. Sem card configurado (workspace sem pipeline), ainda resolve a
   * conversa — o dono pediu para sumir da tela, e a ausência de pipeline é
   * problema de configuração, não motivo para o botão não funcionar.
   */
  router.post(
    '/api/dashboard/today/:id/lost',
    requireAuth,
    withRLS,
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = lostSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: 'Motivo inválido.', issues: parsed.error.issues });
        return;
      }
      const reason = parsed.data.reason ?? null;

      const role = req.auth!.member.role as Role;
      const memberId = req.auth!.member.id;
      const workspaceId = req.auth!.workspace.id;

      // Marcar perdido FECHA a conversa: a permissão é a mesma de resolver.
      const perm: Permission = 'conversation.resolve';
      if (!can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }

      const resultado = await req.scoped!(async (tx): Promise<Resultado> => {
        // 404 (não confirma existência) precede qualquer efeito — IDOR-safe.
        if (
          !(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))
        ) {
          return { kind: 'not_found' };
        }

        // 1. Card. Sem pipeline configurado devolve null — seguimos mesmo assim.
        const deal = await ensureDealForConversation(tx, conversationId, {
          workspaceId,
          actorMemberId: memberId,
        });

        // 2. Fecha perdido + histórico (mesma verdade de `deals/crud.ts`:
        //    `closed_won = false` é o que define perdido, não o estágio).
        if (deal !== null) {
          await tx
            .update(schema.deals)
            .set({ closedAt: new Date(), closedWon: false, updatedAt: new Date() })
            .where(eq(schema.deals.id, deal.id));
          await tx.insert(schema.dealHistory).values({
            dealId: deal.id,
            workspaceId,
            eventType: 'closed',
            toValue: { closedWon: false, reason, origin: 'today' },
            actorMemberId: memberId,
            actorType: 'member',
          });
        }

        // 3. Some da tela. `closed_at` só na primeira vez (mesmo guard de
        //    `state.ts`): reabrir e perder de novo não reescreve o marco.
        await tx
          .update(schema.conversations)
          .set({
            status: 'resolved',
            resolvedAt: sql`coalesce(${schema.conversations.resolvedAt}, now())`,
            updatedAt: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        return { kind: 'ok', dealId: deal?.id ?? null };
      });

      if (resultado.kind === 'not_found') {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      res.json({ conversationId, dealId: resultado.dealId, status: 'resolved' });
    },
  );

  return router;
}
