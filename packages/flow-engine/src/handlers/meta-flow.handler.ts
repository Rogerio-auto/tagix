/**
 * Handler `meta_flow` (FLOW_BUILDER.md §4).
 *
 * Stub no-op do scaffold S02: schema permissivo + execute trivial. O slot de handler
 * dono substitui APENAS este arquivo (registry/index sao de S02 e nao mudam).
 */
import { z } from 'zod';
import type { FlowHandler } from '../types';

const meta_flowSchema = z.record(z.unknown());

export const metaFlowHandler: FlowHandler<z.infer<typeof meta_flowSchema>> = {
  schema: meta_flowSchema,
  async execute(_node, _ctx) {
    // STUB (F4-S02 scaffold). Impl real entra no slot de handler correspondente.
    return { status: 'SUCCESS' };
  },
};
