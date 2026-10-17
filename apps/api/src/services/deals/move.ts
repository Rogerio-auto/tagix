/**
 * Mover um negócio de estágio com o efeito de saída por webhook (F73-S08, extraído de
 * `routes/deals/crud.ts`).
 *
 * É o caminho de QUEM MOVE POR UMA PESSOA (a tela e o Copiloto): `moveDealToStage` (regras de
 * transição, histórico e seam) e, se o negócio realmente mudou de estágio, o evento de domínio
 * `deal.stage_changed` na outbox da MESMA transação (webhooks de saída, F70-S09/S17).
 */
import { enqueueOutbox, type DbTx } from '@hm/db';
import { domainEvents, domainEventsOutbox } from '@hm/shared/mq';
import { moveDealToStage, type MoveDealArgs, type MoveDealResult } from '../deal-move';

export async function moveDeal(tx: DbTx, args: MoveDealArgs): Promise<MoveDealResult> {
  const moved = await moveDealToStage(tx, args);
  // Movimento real (não o no-op para o mesmo estágio), na outbox da mesma transação.
  if (moved.fromStageId !== moved.toStageId) {
    await enqueueOutbox(
      tx,
      domainEventsOutbox([
        domainEvents.dealStageChanged(args.workspaceId, {
          dealId: moved.deal.id,
          pipelineId: moved.deal.pipelineId,
          fromStageId: moved.fromStageId,
          toStageId: moved.toStageId,
          actorType: args.actor.type,
        }),
      ]),
    );
  }
  return moved;
}
