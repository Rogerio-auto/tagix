import { describe, expect, it } from 'vitest';
import { FLOW_NODE_TYPES, getHandler, handlerRegistry } from './registry';

const EXPECTED = [
  'trigger',
  'message',
  'interactive',
  'meta_flow',
  'wait',
  'wait_for_response',
  'condition',
  'switch',
  'ai_action',
  'add_tag',
  'remove_tag',
  'move_stage',
  'register_conversion',
  'change_status',
  'http_request',
  'external_notify',
  'set_variable',
  'input',
  'assign',
  'template',
  'ab_split',
  'go_to_flow',
];

describe('handlerRegistry', () => {
  it('cobre os 22 tipos de node', () => {
    expect(FLOW_NODE_TYPES.slice().sort()).toEqual(EXPECTED.slice().sort());
    expect(Object.keys(handlerRegistry)).toHaveLength(22);
  });

  it('getHandler resolve handler conhecido e undefined p/ desconhecido', () => {
    expect(getHandler('message')).toBeDefined();
    expect(getHandler('nope')).toBeUndefined();
  });

  it('todo handler expoe schema + execute', () => {
    for (const type of FLOW_NODE_TYPES) {
      const h = getHandler(type);
      expect(h).toBeDefined();
      expect(typeof h?.execute).toBe('function');
      expect(h?.schema).toBeDefined();
    }
  });
});
