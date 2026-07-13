import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/lib/api-client';
import { describeLoadError, describeSaveError } from './errors';

describe('describeLoadError (UX §2.11: o quê / por quê / o que fazer)', () => {
  it('404 é definitivo: sem botão de retry', () => {
    const copy = describeLoadError(new ApiError(404, 'not found'));
    expect(copy.title).toBe('Campanha não encontrada');
    expect(copy.retryable).toBe(false);
    expect(copy.whatToDo.length).toBeGreaterThan(0);
  });

  it('403 explica permissão; 401 permite tentar de novo após relogar', () => {
    expect(describeLoadError(new ApiError(403, 'forbidden')).retryable).toBe(false);
    expect(describeLoadError(new ApiError(401, 'unauthorized')).retryable).toBe(true);
  });

  it('500 propaga a referência copiável do backend', () => {
    const copy = describeLoadError(new ApiError(500, 'boom', 'hm_err_abc123'));
    expect(copy.reference).toBe('hm_err_abc123');
    expect(copy.retryable).toBe(true);
  });

  it('erro de rede (sem ApiError) vira falha de conexão, nunca "algo deu errado"', () => {
    const copy = describeLoadError(new TypeError('Failed to fetch'));
    expect(copy.reason).toContain('conexão');
    expect(copy.reference).toBeUndefined();
    expect(copy.retryable).toBe(true);
  });
});

describe('describeSaveError', () => {
  it('409 = campanha nao é mais rascunho (causa real, não erro genérico)', () => {
    expect(describeSaveError(new ApiError(409, 'not_editable'))).toContain('rascunho');
  });

  it('cai num fallback acionável para erro desconhecido', () => {
    expect(describeSaveError(new Error('x'))).toContain('Tente de novo');
  });
});
