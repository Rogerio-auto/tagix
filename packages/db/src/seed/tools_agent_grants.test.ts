/**
 * F70-S23 — o que o seed da Arcada libera nas tools de contato. Puro, sem banco.
 */
import { describe, expect, it } from 'vitest';
import { ARCADA_TAGS } from './agent_templates_arcada.content';
import { ARCADA_TOOL_KEYS } from './agent_templates_arcada';
import { ARCADA_AGENT_TOOL_OVERRIDES, seededToolOverrides } from './tools_agent_grants';

describe('liberações do agente da Arcada', () => {
  it('add_contact_tag: só atendimento-humano; as etiquetas dos flows ficam de fora', () => {
    const overrides = seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, 'add_contact_tag');
    expect(overrides).toEqual({ allowed_tags: ['atendimento-humano'] });
    const allowed = overrides['allowed_tags'] as string[];
    expect(allowed).not.toContain(ARCADA_TAGS.aiActivated.name);
    expect(allowed).not.toContain(ARCADA_TAGS.cooledDown.name);
  });

  it('update_contact: nenhum campo personalizado liberado', () => {
    expect(seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, 'update_contact')).toEqual({
      custom_fields_write_keys: [],
    });
  });

  it('só libera tools que o agente da Arcada tem, e as demais saem sem override', () => {
    for (const key of Object.keys(ARCADA_AGENT_TOOL_OVERRIDES)) {
      expect((ARCADA_TOOL_KEYS as readonly string[]).includes(key), key).toBe(true);
    }
    expect(seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, 'transfer_to_human')).toEqual({});
    expect(seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, '__proto__')).toEqual({});
  });

  it('devolve cópia: mexer no resultado não altera a fonte', () => {
    const copy = seededToolOverrides(ARCADA_AGENT_TOOL_OVERRIDES, 'add_contact_tag');
    (copy['allowed_tags'] as string[]).push('comprou');
    expect(ARCADA_AGENT_TOOL_OVERRIDES['add_contact_tag']).toEqual({
      allowed_tags: ['atendimento-humano'],
    });
  });
});
