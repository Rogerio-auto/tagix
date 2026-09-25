/**
 * F70-S23 (L-b) — allowlist por tool do que vai para `tool_logs`. Puro, sem banco.
 */
import { describe, expect, it } from 'vitest';
import { redactLogArgs, redactLogResult, TOOL_LOG_POLICIES } from './log-redaction';
import { buildWorkflowRegistry } from './workflow-handlers';
import { registerCalendarHandlers } from './calendar-handlers';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('redactLogArgs', () => {
  it('toda tool registrada no endpoint tem política declarada', () => {
    const registry = registerCalendarHandlers(buildWorkflowRegistry());
    for (const key of registry.keys()) {
      expect(Object.hasOwn(TOOL_LOG_POLICIES, key), key).toBe(true);
    }
  });

  it('schedule_event: título e texto livre sem dado pessoal; descrição/local nem aparecem em claro', () => {
    const out = redactLogArgs('schedule_event', {
      title: 'Consulta Maria Souza 11 99999-0000',
      start_at: '2099-01-05T10:00:00-03:00',
      end_at: '2099-01-05T11:00:00-03:00',
      description: 'CPF 123.456.789-00',
      location: 'Rua das Flores, 10',
      meeting_url: 'https://meet.x/abc?email=ana@x.com',
      contact_id: UUID,
      type: 'meeting',
    });
    expect(out['title']).toBe('Consulta Maria Souza ## #####-####');
    expect(out['start_at']).toBe('2099-01-05T10:00:00-03:00');
    expect(out['description']).toBe('[redacted:string]');
    expect(out['location']).toBe('[redacted:string]');
    expect(out['meeting_url']).toBe('[redacted:string]');
    expect(out['contact_id']).toBe(UUID);
    expect(out['type']).toBe('meeting');
  });

  it('campo declarado com valor do tipo errado é mascarado (id, token, número)', () => {
    const out = redactLogArgs('register_conversion', {
      type_key: '11999990000',
      contact_id: 'maria@x.com',
      value_cents: '12345',
      currency: { nested: 'x' },
    });
    expect(out).toEqual({
      type_key: '[redacted:string]',
      contact_id: '[redacted:string]',
      value_cents: '[redacted:string]',
      currency: { nested: '[redacted:string]' },
    });
  });

  it('recursivo: objetos e arrays fora da política mantêm só a forma', () => {
    const out = redactLogArgs('escalate', {
      reason: 'ok',
      extra: [{ phone: '+5511999990000', deep: { email: 'a@b.c', n: 1, ok: true, z: null } }],
    });
    expect(out['extra']).toEqual([
      {
        phone: '[redacted:string]',
        deep: {
          email: '[redacted:string]',
          n: '[redacted:number]',
          ok: '[redacted:boolean]',
          z: null,
        },
      },
    ]);
  });

  it('chave inventada pelo modelo também é mascarada (sem dígitos)', () => {
    const out = redactLogArgs('update_contact', { custom_fields: { cpf_12345678900: 'x' } });
    expect(out['custom_fields']).toEqual({ 'cpf_###########': '[redacted:string]' });
  });

  it('tool desconhecida: tudo mascarado', () => {
    expect(redactLogArgs('nao_existe', { a: 'Maria', b: [1, 'x'] })).toEqual({
      a: '[redacted:string]',
      b: ['[redacted:number]', '[redacted:string]'],
    });
  });
});

describe('redactLogResult', () => {
  it('list_calendars: nome do calendário vira texto mascarado, ids ficam', () => {
    const out = redactLogResult('list_calendars', {
      calendars: [{ id: UUID, name: 'Agenda Dr. Paulo 3', type: 'personal', is_default: true }],
    });
    expect(out).toEqual({
      calendars: [{ id: UUID, name: 'Agenda Dr. Paulo #', type: 'personal', is_default: true }],
    });
  });

  it('content (sem payload) é texto livre', () => {
    expect(redactLogResult('add_contact_tag', { content: "Etiqueta '11 99999' aplicada" })).toEqual(
      {
        content: "Etiqueta '## #####' aplicada",
      },
    );
  });
});
