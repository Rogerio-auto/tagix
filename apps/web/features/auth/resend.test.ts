import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/lib/api-client';
import { signupSchema } from './schema';
import { TERMS_VERSION } from './terms';
import {
  RESEND_COOLDOWN_SECONDS,
  classifyResendError,
  cooldownRemaining,
  loginNoticeFor,
  resendButtonLabel,
  resendSuccessMessage,
  sanitizeEmailParam,
} from './resend';

describe('contagem de reenvio', () => {
  it('é de 60 s e conta para baixo arredondando para cima', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    const start = 1_000_000;
    const until = start + 60_000;
    expect(cooldownRemaining(until, start)).toBe(60);
    expect(cooldownRemaining(until, start + 1)).toBe(60);
    expect(cooldownRemaining(until, start + 1_000)).toBe(59);
    expect(cooldownRemaining(until, start + 59_001)).toBe(1);
    expect(cooldownRemaining(until, until)).toBe(0);
    expect(cooldownRemaining(until, until + 5_000)).toBe(0);
  });

  it('o rótulo mostra os segundos e volta ao padrão', () => {
    expect(resendButtonLabel(42)).toBe('Reenviar em 42 s');
    expect(resendButtonLabel(0)).toBe('Reenviar email');
  });

  it('a mensagem de sucesso não depende de a conta existir', () => {
    expect(resendSuccessMessage('a@b.co')).toContain('Se houver uma conta');
  });
});

describe('classifyResendError', () => {
  it('mapeia os erros do contrato da API', () => {
    expect(classifyResendError(new ApiError(429, 'x', undefined, undefined, 'rate_limited'))).toBe(
      'rate_limited',
    );
    expect(
      classifyResendError(new ApiError(400, 'x', undefined, undefined, 'captcha_failed')),
    ).toBe('captcha');
    expect(
      classifyResendError(new ApiError(400, 'x', undefined, undefined, 'invalid_payload')),
    ).toBe('invalid_email');
    expect(classifyResendError(new ApiError(500, 'x'))).toBe('unknown');
    expect(classifyResendError(new Error('rede'))).toBe('unknown');
  });
});

describe('login vindo de outra tela', () => {
  it('escolhe o aviso pela origem', () => {
    expect(loginNoticeFor('invite', true)).toBe('invite');
    expect(loginNoticeFor('verify', true)).toBe('verified');
    expect(loginNoticeFor(undefined, true)).toBe('generic');
    expect(loginNoticeFor(undefined, false)).toBeNull();
  });

  it('só aceita email plausível em ?email=', () => {
    expect(sanitizeEmailParam('ana@empresa.com')).toBe('ana@empresa.com');
    expect(sanitizeEmailParam(['ana@empresa.com', 'x'])).toBe('ana@empresa.com');
    expect(sanitizeEmailParam('<script>')).toBe('');
    expect(sanitizeEmailParam(undefined)).toBe('');
  });
});

describe('signup exige o aceite dos termos', () => {
  const base = {
    name: 'Ana',
    email: 'ana@empresa.com',
    password: 'senha-forte-123',
    workspaceName: 'Acme',
  };

  it('bloqueia sem o aceite', () => {
    const r = signupSchema.safeParse({ ...base, acceptTerms: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toContain('acceptTerms');
    }
  });

  it('passa com o aceite', () => {
    expect(signupSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });

  it('a versão dos termos tem o formato exigido pela API', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
