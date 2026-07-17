import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/lib/api-client';
import { describeApiError } from '@/shared/lib/api-error-message';

describe('describeApiError — mapeamento por status', () => {
  it('401 → sessão expirou, acionável e requiresReauth', () => {
    const m = describeApiError(new ApiError(401, 'Unauthorized'));
    expect(m.status).toBe(401);
    expect(m.title).toMatch(/sess/i);
    expect(m.requiresReauth).toBe(true);
    expect(m.retryable).toBe(true);
    // Nunca deve mascarar 401 como "conexão falhou".
    expect(m.title).not.toMatch(/conex/i);
  });

  it('403 → sem permissão, não relogar, não retryable', () => {
    const m = describeApiError(new ApiError(403, 'Forbidden'));
    expect(m.title).toMatch(/permiss/i);
    expect(m.requiresReauth).toBe(false);
    expect(m.retryable).toBe(false);
  });

  it('404 → não encontrado, não retryable', () => {
    const m = describeApiError(new ApiError(404, 'Not Found'));
    expect(m.title).toMatch(/encontrad/i);
    expect(m.retryable).toBe(false);
  });

  it('409 → conflito de edição, retryable', () => {
    const m = describeApiError(new ApiError(409, 'Conflict'));
    expect(m.retryable).toBe(true);
    expect(m.whatToDo).toMatch(/recarreg/i);
  });

  it.each([400, 422])('%d → dados inválidos, não retryable', (status) => {
    const m = describeApiError(new ApiError(status, 'Bad'));
    expect(m.title).toMatch(/inválid/i);
    expect(m.retryable).toBe(false);
  });

  it('429 → muitas tentativas, retryable', () => {
    const m = describeApiError(new ApiError(429, 'Too Many Requests'));
    expect(m.title).toMatch(/tentativas/i);
    expect(m.retryable).toBe(true);
  });

  it.each([500, 502, 503])('%d → erro no servidor, retryable', (status) => {
    const m = describeApiError(new ApiError(status, 'Server Error'));
    expect(m.title).toMatch(/servidor/i);
    expect(m.retryable).toBe(true);
    expect(m.requiresReauth).toBe(false);
  });
});

describe('describeApiError — presença do ref', () => {
  it('expõe o ref do ApiError (X-Error-Ref) em 5xx', () => {
    const m = describeApiError(new ApiError(500, 'boom', 'hm_err_abc123'));
    expect(m.reference).toBe('hm_err_abc123');
  });

  it('sem ref no erro → reference indefinido (não fabrica string)', () => {
    const m = describeApiError(new ApiError(500, 'boom'));
    expect(m.reference).toBeUndefined();
  });

  it('propaga o ref também em 401/403 quando o backend enviar', () => {
    const m = describeApiError(new ApiError(403, 'no', 'hm_err_perm'));
    expect(m.reference).toBe('hm_err_perm');
  });
});

describe('describeApiError — fallback', () => {
  it('erro não-HTTP (Error comum) → falha de conexão, status 0', () => {
    const m = describeApiError(new Error('fetch failed'));
    expect(m.status).toBe(0);
    expect(m.title).toMatch(/conexão/i);
    expect(m.retryable).toBe(true);
    expect(m.reference).toBeUndefined();
  });

  it('valor arbitrário (unknown) → fallback de rede sem quebrar', () => {
    const m = describeApiError('algo estranho');
    expect(m.status).toBe(0);
    expect(m.title).toMatch(/conexão/i);
  });

  it('status HTTP não mapeado (ex.: 418) → fallback', () => {
    const m = describeApiError(new ApiError(418, "I'm a teapot"));
    expect(m.title).toMatch(/conexão/i);
    expect(m.retryable).toBe(true);
  });
});
