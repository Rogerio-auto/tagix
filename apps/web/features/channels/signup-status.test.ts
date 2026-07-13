/**
 * F56-S05 / UX-01 + UX-12 — as duas invariantes da ativação recuperável:
 *  - sem envs da Meta, o build sabe que o Embedded Signup NÃO existe (e a UI não
 *    pode pedir um `code` que só o popup emite);
 *  - toda falha do signup vira cópia acionável (o quê / por quê / o que fazer) e
 *    diz se cabe retry e/ou fallback manual — nunca um beco sem saída.
 */
import { describe, expect, it } from 'vitest';
import {
  describeMetaSignupConfig,
  describeSignupFailure,
  MetaSignupError,
  signupFailureCopy,
  type SignupFailureReason,
} from './signup-status';

describe('describeMetaSignupConfig', () => {
  it('as duas envs presentes → Embedded Signup disponível', () => {
    expect(describeMetaSignupConfig('123', 'cfg_1')).toEqual({ configured: true, missing: [] });
  });

  it('env ausente ou vazia → indisponível, com o que falta nomeado para o suporte', () => {
    expect(describeMetaSignupConfig(undefined, 'cfg_1')).toEqual({
      configured: false,
      missing: ['NEXT_PUBLIC_META_APP_ID'],
    });
    expect(describeMetaSignupConfig('123', '   ')).toEqual({
      configured: false,
      missing: ['NEXT_PUBLIC_META_CONFIG_ID'],
    });
    expect(describeMetaSignupConfig(undefined, undefined)).toEqual({
      configured: false,
      missing: ['NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_CONFIG_ID'],
    });
  });
});

describe('describeSignupFailure', () => {
  const RECOVERABLE: readonly SignupFailureReason[] = [
    'sdk_load_failed',
    'cancelled',
    'timeout',
    'incomplete',
    'meta_error',
    'unknown',
  ];

  it('timeout do Embedded Signup habilita o fallback manual (UX-12)', () => {
    const copy = describeSignupFailure(new MetaSignupError('timeout', 'sem resposta'));
    expect(copy.reason).toBe('timeout');
    expect(copy.canFallbackManual).toBe(true);
    expect(copy.canRetry).toBe(true);
  });

  it('erro desconhecido (rede/bug) não vira beco sem saída', () => {
    const copy = describeSignupFailure(new Error('boom'));
    expect(copy.reason).toBe('unknown');
    expect(copy.canFallbackManual).toBe(true);
  });

  it('não-configurado NÃO oferece manual: o `code` é impossível sem o popup (UX-01)', () => {
    const copy = describeSignupFailure(new MetaSignupError('not_configured', 'sem app id'));
    expect(copy.canFallbackManual).toBe(false);
    expect(copy.canRetry).toBe(false);
  });

  it('erro reportado pela própria Meta preserva a mensagem dela no "por quê"', () => {
    const copy = describeSignupFailure(
      new MetaSignupError('meta_error', 'Conta comercial não verificada.'),
    );
    expect(copy.why).toBe('Conta comercial não verificada.');
    expect(copy.whatToDo).not.toBe('');
  });

  it('toda falha recuperável tem as 3 partes preenchidas e uma saída', () => {
    for (const reason of RECOVERABLE) {
      const copy = signupFailureCopy(reason);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.why.length).toBeGreaterThan(0);
      expect(copy.whatToDo.length).toBeGreaterThan(0);
      expect(copy.canRetry || copy.canFallbackManual).toBe(true);
    }
  });
});
