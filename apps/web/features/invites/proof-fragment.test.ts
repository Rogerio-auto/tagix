import { describe, expect, it, vi } from 'vitest';
import { consumeProofFromFragment, type FragmentHost } from './proof-fragment';

function host(hash: string, search = ''): { host: FragmentHost; replace: ReturnType<typeof vi.fn> } {
  const replace = vi.fn();
  return {
    replace,
    host: {
      location: { hash, pathname: '/convite/tok123', search },
      history: { replaceState: replace },
    },
  };
}

describe('consumeProofFromFragment (prova de posse do email)', () => {
  it('lê token_hash e type do fragmento e limpa a URL na hora', () => {
    const h = host('#token_hash=abcDEF123_-xyz&type=invite');
    expect(consumeProofFromFragment(h.host)).toEqual({ tokenHash: 'abcDEF123_-xyz', type: 'invite' });
    expect(h.replace).toHaveBeenCalledWith(null, '', '/convite/tok123');
  });

  it('aceita magiclink', () => {
    const h = host('#token_hash=abcdefgh12&type=magiclink');
    expect(consumeProofFromFragment(h.host)?.type).toBe('magiclink');
  });

  it('sem fragmento: nada a ler e nada a limpar', () => {
    const h = host('');
    expect(consumeProofFromFragment(h.host)).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('remove o #access_token legado do Supabase e não o usa como prova', () => {
    const h = host('#access_token=eyJhbGciOi.x.y&refresh_token=zzz&type=invite');
    expect(consumeProofFromFragment(h.host)).toBeNull();
    expect(h.replace).toHaveBeenCalledWith(null, '', '/convite/tok123');
  });

  it('rejeita tipo desconhecido e hash fora do alfabeto/tamanho, mas limpa a URL', () => {
    for (const hash of [
      '#token_hash=abcdefgh12&type=recovery',
      '#token_hash=curto&type=invite',
      '#token_hash=abc%20def%20ghi&type=invite',
      '#type=invite',
    ]) {
      const h = host(hash);
      expect(consumeProofFromFragment(h.host)).toBeNull();
      expect(h.replace).toHaveBeenCalledTimes(1);
    }
  });

  it('nunca lê da query string', () => {
    const h = host('', '?token_hash=abcdefgh12&type=invite');
    expect(consumeProofFromFragment(h.host)).toBeNull();
  });

  it('preserva a query ao limpar o fragmento', () => {
    const h = host('#token_hash=abcdefgh12&type=invite', '?x=1');
    consumeProofFromFragment(h.host);
    expect(h.replace).toHaveBeenCalledWith(null, '', '/convite/tok123?x=1');
  });
});
