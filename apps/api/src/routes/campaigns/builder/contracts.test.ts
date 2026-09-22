import { describe, expect, it } from 'vitest';
import {
  decodeBindings,
  deliveryOverridesSchema,
  encodeBindings,
  isBindingContract,
  parseRequiredIdempotencyKey,
  templateBindingsSchema,
  testSendSchema,
  toPublicCampaignMode,
  toStoredCampaignType,
  type TemplateBinding,
} from './contracts';

const BINDINGS: TemplateBinding[] = [
  { component: 'body', index: 1, source: { kind: 'contact', field: 'displayName', fallback: 'cliente' } },
  { component: 'body', index: 2, source: { kind: 'fixed', value: '10%' } },
];

describe('linguagem do produto ↔ domínio técnico', () => {
  it('Envio único é broadcast e Sequência é drip', () => {
    expect(toStoredCampaignType('single')).toBe('broadcast');
    expect(toStoredCampaignType('sequence')).toBe('drip');
    expect(toPublicCampaignMode('broadcast')).toBe('single');
    expect(toPublicCampaignMode('drip')).toBe('sequence');
  });

  it('triggered não tem nome de produto', () => {
    expect(toPublicCampaignMode('triggered')).toBeNull();
  });
});

describe('contrato de bindings persistido', () => {
  it('vai e volta sem perder nada', () => {
    expect(decodeBindings(encodeBindings(BINDINGS))).toEqual(BINDINGS);
    expect(isBindingContract(encodeBindings(BINDINGS))).toBe(true);
  });

  it('não confunde componentes Graph antigos com o envelope', () => {
    expect(decodeBindings([{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }])).toBeNull();
    expect(decodeBindings([])).toBeNull();
    expect(decodeBindings(null)).toBeNull();
    expect(decodeBindings('nope')).toBeNull();
  });

  it('recusa envelope de versão desconhecida em vez de adivinhar', () => {
    expect(decodeBindings([{ type: 'binding_contract', version: 2, bindings: BINDINGS }])).toBeNull();
  });

  it('recusa envelope com bindings corrompidos', () => {
    expect(
      decodeBindings([{ type: 'binding_contract', version: 1, bindings: [{ component: 'body' }] }]),
    ).toBeNull();
  });

  it('fallback é obrigatório e não pode ser vazio em origem dinâmica', () => {
    expect(
      templateBindingsSchema.safeParse([
        { component: 'body', index: 1, source: { kind: 'contact', field: 'displayName' } },
      ]).success,
    ).toBe(false);
    expect(
      templateBindingsSchema.safeParse([
        { component: 'body', index: 1, source: { kind: 'contact', field: 'displayName', fallback: '  ' } },
      ]).success,
    ).toBe(false);
  });

  it('a mesma variável não pode ser configurada duas vezes', () => {
    const parsed = templateBindingsSchema.safeParse([BINDINGS[0], BINDINGS[0]]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toContain('mais de uma vez');
  });

  it('não aceita campo de contato fora da lista', () => {
    expect(
      templateBindingsSchema.safeParse([
        { component: 'body', index: 1, source: { kind: 'contact', field: 'cpf', fallback: 'x' } },
      ]).success,
    ).toBe(false);
  });
});

describe('ajustes de entrega ainda não salvos', () => {
  it('aceita ritmo, teto, horários e início', () => {
    const parsed = deliveryOverridesSchema.safeParse({
      ratePerMinute: 30,
      dailyLimit: 500,
      timezone: 'America/Sao_Paulo',
      startAt: '2026-08-20T12:00:00.000Z',
      sendWindows: { enabled: true, windows: [{ day: 1, start: '09:00', end: '18:00' }] },
    });
    expect(parsed.success).toBe(true);
  });

  it('recusa janela que termina antes de começar', () => {
    expect(
      deliveryOverridesSchema.safeParse({
        sendWindows: { enabled: true, windows: [{ day: 1, start: '18:00', end: '09:00' }] },
      }).success,
    ).toBe(false);
  });

  it('recusa hora inválida e campo desconhecido', () => {
    expect(
      deliveryOverridesSchema.safeParse({
        sendWindows: { enabled: true, windows: [{ day: 1, start: '25:00', end: '26:00' }] },
      }).success,
    ).toBe(false);
    expect(deliveryOverridesSchema.safeParse({ rate: 10 }).success).toBe(false);
  });
});

describe('envio de teste', () => {
  it('exige destinatário em E.164', () => {
    const base = { templateId: '00000000-0000-0000-0000-000000000001', bindings: [] };
    expect(testSendSchema.safeParse({ ...base, to: '+5511999998888' }).success).toBe(true);
    expect(testSendSchema.safeParse({ ...base, to: '11999998888' }).success).toBe(false);
    expect(testSendSchema.safeParse({ ...base, to: '+0511999998888' }).success).toBe(false);
  });

  it('chave de idempotência precisa existir e ter tamanho sensato', () => {
    expect(parseRequiredIdempotencyKey('abc')).toBe('abc');
    expect(parseRequiredIdempotencyKey('   ')).toBeNull();
    expect(parseRequiredIdempotencyKey(undefined)).toBeNull();
    expect(parseRequiredIdempotencyKey(['a', 'b'])).toBeNull();
    expect(parseRequiredIdempotencyKey('x'.repeat(201))).toBeNull();
  });
});
