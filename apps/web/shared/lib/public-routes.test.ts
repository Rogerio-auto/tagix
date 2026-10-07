import { describe, expect, it } from 'vitest';
import { isPublicPath, isReturnablePublicPath } from './public-routes';

describe('public-routes (F71-S07)', () => {
  it('/convite/<token> abre sem sessão; prefixo solto não', () => {
    expect(isPublicPath('/convite/abc123')).toBe(true);
    expect(isPublicPath('/convite')).toBe(true);
    expect(isPublicPath('/convites-internos')).toBe(false);
  });

  it('só o convite é destino de retorno depois do login', () => {
    expect(isReturnablePublicPath('/convite/abc123')).toBe(true);
    expect(isReturnablePublicPath('/login')).toBe(false);
    expect(isReturnablePublicPath('/signup')).toBe(false);
  });
});
