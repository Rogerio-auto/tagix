/**
 * Handler `move_stage` (FLOW_BUILDER.md §4). STUB-ATE-F5 (Pipeline, F5): no-op que loga e segue.
 *
 * Stub no-op do scaffold S02: schema permissivo + execute trivial. O slot de handler
 * dono substitui APENAS este arquivo (registry/index sao de S02 e nao mudam).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const move_stageSchema = z.record(z.unknown());

export const moveStageHandler: FlowHandler<z.infer<typeof move_stageSchema>> = {
  schema: move_stageSchema,
  async execute(_node, ctx) {
    // STUB-ATE-F5: depende de deals/stages/contact_tags (dominio Pipeline, F5).
    // Nao falha o flow — apenas loga e segue para a proxima edge (FLOW_BUILDER stub-guard).
    ctx.log('warn', 'handler move_stage e stub ate a F5 (Pipeline); no-op', {
      nodeType: 'move_stage',
      executionId: ctx.executionId,
    });
    return { status: 'SUCCESS' };
  },
};
