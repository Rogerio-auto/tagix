/**
 * Handler `remove_tag` (FLOW_BUILDER.md §4). STUB-ATE-F5 (Pipeline, F5): no-op que loga e segue.
 *
 * Stub no-op do scaffold S02: schema permissivo + execute trivial. O slot de handler
 * dono substitui APENAS este arquivo (registry/index sao de S02 e nao mudam).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const remove_tagSchema = z.record(z.unknown());

export const removeTagHandler: FlowHandler<z.infer<typeof remove_tagSchema>> = {
  schema: remove_tagSchema,
  async execute(_node, ctx) {
    // STUB-ATE-F5: depende de deals/stages/contact_tags (dominio Pipeline, F5).
    // Nao falha o flow — apenas loga e segue para a proxima edge (FLOW_BUILDER stub-guard).
    ctx.log('warn', 'handler remove_tag e stub ate a F5 (Pipeline); no-op', {
      nodeType: 'remove_tag',
      executionId: ctx.executionId,
    });
    return { status: 'SUCCESS' };
  },
};
