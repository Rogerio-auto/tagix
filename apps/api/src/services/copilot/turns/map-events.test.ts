/**
 * F73-S10 — mapeamento dos eventos internos do runtime para o contrato público (unitário).
 * Todo frame produzido é validado no `CopilotStreamEventSchema`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CopilotRuntimeEventSchema,
  CopilotStreamEventSchema,
  statusLabelFor,
  type CopilotRuntimeEvent,
} from '@hm/shared';
import { defineCopilotTool } from '../../../internal/copilot/core/registry';
import { createEventMapper, publicErrorCode } from './map-events';

const FIXTURES = fileURLToPath(
  new URL('../../../../../agent-runtime/tests/copilot/fixtures/', import.meta.url),
);
function fixture(name: string): CopilotRuntimeEvent[] {
  const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}${name}`, 'utf8'));
  return z.array(CopilotRuntimeEventSchema).parse(raw);
}

const listDeals = defineCopilotTool({
  key: 'list_deals',
  capability: 'query',
  area: 'pipeline',
  description: 'Lista negócios.',
  args: z.object({}).strict(),
  taintsTurn: false,
  async handler() {
    return { ok: true, decision: 'executed', model_view: 'ok' };
  },
});

describe('createEventMapper', () => {
  it('fixture do runtime: status do catálogo, cartão do envelope, veredito, final com refs vistos', () => {
    const mapper = createEventMapper([listDeals]);
    const emitted: unknown[] = [];
    let finalBlocks: unknown = null;
    for (const ev of fixture('turn_events.json')) {
      const step = mapper.map(ev);
      if (step.kind === 'emit') {
        expect(CopilotStreamEventSchema.safeParse(step.event).success).toBe(true);
        emitted.push(step.event);
      }
      if (step.kind === 'final') finalBlocks = step.blocks;
    }
    const expectedLabel = statusLabelFor('query', 'pipeline');
    expect(emitted[0]).toEqual({
      v: 1,
      type: 'status',
      phase: expectedLabel.phase,
      label: expectedLabel.label,
    });
    expect(emitted[1]).toMatchObject({
      v: 1,
      type: 'tool_result',
      kind: 'deal_list',
      result_id: 'r-deals-1',
    });
    expect(mapper.state.cards).toHaveLength(1);
    expect(mapper.state.cards[0]).not.toHaveProperty('type');
    expect(mapper.state.verdict).toBe(
      'Três negócios de alinhadores estão parados há mais de 7 dias, somando R$ 19.900.',
    );
    expect(finalBlocks).toMatchObject({ data_refs: ['r-deals-1'] });
  });

  it('data_refs inventado pelo modelo é removido do final', () => {
    const mapper = createEventMapper([listDeals]);
    const events = fixture('turn_events.json');
    const final = events.find((e) => e.type === 'final');
    if (!final || final.type !== 'final') throw new Error('fixture sem final');
    for (const ev of events.filter((e) => e.type !== 'final')) mapper.map(ev);
    const step = mapper.map({
      ...final,
      blocks: { ...final.blocks, data_refs: ['r-deals-1', 'inventado'] },
    });
    expect(step.kind).toBe('final');
    if (step.kind === 'final') expect(step.blocks.data_refs).toEqual(['r-deals-1']);
  });

  it('ferramenta fora do registro não gera status; status nunca tem texto do modelo', () => {
    const mapper = createEventMapper([listDeals]);
    expect(mapper.map({ type: 'status', tool_key: 'delete_everything' })).toEqual({
      kind: 'none',
      reason: 'unknown_tool',
    });
  });

  it('envelope incoerente (result_id do cartão ≠ do envelope) não vira cartão', () => {
    const mapper = createEventMapper([listDeals]);
    const ev = fixture('turn_events.json').find((e) => e.type === 'tool_call_completed');
    if (!ev || ev.type !== 'tool_call_completed') throw new Error('fixture');
    const step = mapper.map({ ...ev, envelope: { ...ev.envelope, result_id: 'outro' } });
    expect(step).toEqual({ kind: 'none', reason: 'incoherent_envelope' });
    expect(mapper.state.seenResultIds.size).toBe(0);
  });

  it('iteration_exceeded marca o turno e o final ainda sai', () => {
    const mapper = createEventMapper([listDeals]);
    const kinds = fixture('turn_events_iteration_exceeded.json').map((e) => mapper.map(e).kind);
    expect(mapper.state.iterationExceeded).toBe(true);
    expect(kinds[kinds.length - 1]).toBe('final');
  });

  it('error do runtime vira código público fechado', () => {
    const mapper = createEventMapper([listDeals]);
    const steps = fixture('turn_events_timeout.json').map((e) => mapper.map(e));
    expect(steps[steps.length - 1]).toEqual({
      kind: 'error',
      code: 'timeout',
      runtimeCode: 'timeout',
    });
    expect(publicErrorCode('provider_error')).toBe('runtime_unavailable');
    expect(publicErrorCode('iteration_exceeded')).toBe('iteration_limit');
    expect(publicErrorCode('algo_novo')).toBe('internal');
  });
});
