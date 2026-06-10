import { describe, expect, it } from 'vitest';
import { extractVarReferences, interpolate } from './interpolate';

describe('interpolate', () => {
  it('substitui {{var}} simples', () => {
    expect(interpolate('Ola {{contact.name}}', { contact: { name: 'Ana' } })).toBe('Ola Ana');
  });

  it('tolera whitespace interno', () => {
    expect(interpolate('{{  trigger.message  }}', { trigger: { message: 'oi' } })).toBe('oi');
  });

  it('deixa token desconhecido literal', () => {
    expect(interpolate('{{nope.x}}', {})).toBe('{{nope.x}}');
  });

  it('serializa objeto via JSON', () => {
    expect(interpolate('{{a}}', { a: { b: 1 } })).toBe('{"b":1}');
  });

  it('extrai referencias', () => {
    expect(extractVarReferences('{{a.b}} e {{c}}')).toEqual(['a.b', 'c']);
  });
});
