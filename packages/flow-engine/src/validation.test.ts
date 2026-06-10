import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from './types';
import { computeReachable, hasCycle, validateFlow } from './validation';

const n = (id: string, type: string, data: unknown = {}): FlowNode => ({ id, type, data });
const e = (id: string, source: string, target: string, sourceHandle?: string): FlowEdge => ({
  id,
  source,
  target,
  sourceHandle,
});

describe('validateFlow', () => {
  it('flow valido minimo passa', () => {
    const r = validateFlow({
      nodes: [n('t', 'trigger'), n('m', 'message', { text: 'oi {{contact.name}}' })],
      edges: [e('e1', 't', 'm')],
    });
    expect(r.valid).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('detecta != 1 trigger', () => {
    const zero = validateFlow({ nodes: [n('m', 'message')], edges: [] });
    expect(zero.valid).toBe(false);
    expect(zero.issues.some((i) => i.code === 'trigger_count')).toBe(true);

    const two = validateFlow({
      nodes: [n('t1', 'trigger'), n('t2', 'trigger')],
      edges: [e('e', 't1', 't2')],
    });
    expect(two.issues.some((i) => i.code === 'trigger_count')).toBe(true);
  });

  it('detecta node inalcancavel', () => {
    const r = validateFlow({
      nodes: [n('t', 'trigger'), n('m', 'message'), n('orphan', 'message')],
      edges: [e('e1', 't', 'm')],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'unreachable' && i.nodeId === 'orphan')).toBe(true);
  });

  it('detecta ciclo', () => {
    const r = validateFlow({
      nodes: [n('t', 'trigger'), n('a', 'message'), n('b', 'message')],
      edges: [e('e1', 't', 'a'), e('e2', 'a', 'b'), e('e3', 'b', 'a')],
    });
    expect(r.issues.some((i) => i.code === 'cycle')).toBe(true);
  });

  it('aponta variavel desconhecida como warning (nao invalida)', () => {
    const r = validateFlow({
      nodes: [n('t', 'trigger'), n('m', 'message', { text: '{{foo.bar}}' })],
      edges: [e('e1', 't', 'm')],
    });
    expect(r.issues.some((i) => i.code === 'unknown_var' && i.severity === 'warning')).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('aceita variavel conhecida do escopo (trigger/contact/webhook_response)', () => {
    const r = validateFlow({
      nodes: [
        n('t', 'trigger'),
        n('m', 'message', {
          text: '{{contact.name}} {{trigger.message}} {{webhook_response.body}}',
        }),
      ],
      edges: [e('e1', 't', 'm')],
    });
    expect(r.issues.some((i) => i.code === 'unknown_var')).toBe(false);
  });
});

describe('helpers', () => {
  it('computeReachable faz BFS', () => {
    const reach = computeReachable(
      [n('t', 'trigger'), n('a', 'message'), n('b', 'message')],
      [e('e1', 't', 'a')],
      't',
    );
    expect(reach.has('a')).toBe(true);
    expect(reach.has('b')).toBe(false);
  });

  it('hasCycle false em DAG', () => {
    expect(hasCycle([n('t', 'trigger'), n('a', 'message')], [e('e1', 't', 'a')])).toBe(false);
  });
});
