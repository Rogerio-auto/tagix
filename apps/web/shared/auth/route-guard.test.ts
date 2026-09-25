/**
 * F70-S28 — guarda de rota do servidor (a lógica do `middleware.ts`).
 *
 * O bug: o middleware só olhava a PRESENÇA de `hm_session`. Cookie morto passava e o
 * app abria vazio, sem ir ao login — no PWA, sem barra de endereço, sem saída.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  checkSession,
  decideRoute,
  isDocumentRequest,
  loginUrl,
  postLoginPath,
  type SessionCheck,
} from './route-guard';

/** Headers de uma navegação de documento (abrir o PWA, digitar a URL, F5). */
function documentHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ 'sec-fetch-dest': 'document', accept: 'text/html', ...extra });
}

function checker(result: SessionCheck) {
  return vi.fn(async (_token: string) => result);
}

describe('decideRoute — rota protegida', () => {
  it('cookie INVÁLIDO → redirect para /login?next=<rota>&motivo=sessao-expirada e apaga o cookie', async () => {
    const check = checker('invalid');
    const decision = await decideRoute(
      { pathname: '/hoje', search: '', sessionToken: 'morto', headers: documentHeaders() },
      check,
    );
    expect(check).toHaveBeenCalledWith('morto');
    expect(decision).toEqual({
      kind: 'redirect',
      location: '/login?next=%2Fhoje&motivo=sessao-expirada',
      clearSession: true,
    });
  });

  it('preserva a query da rota no next', async () => {
    const decision = await decideRoute(
      {
        pathname: '/conversations',
        search: '?id=abc',
        sessionToken: 'morto',
        headers: documentHeaders(),
      },
      checker('invalid'),
    );
    expect(decision).toMatchObject({
      location: '/login?next=%2Fconversations%3Fid%3Dabc&motivo=sessao-expirada',
    });
  });

  it('SEM cookie → redirect para /login?next=<rota>, sem motivo e sem chamar a API', async () => {
    const check = checker('valid');
    const decision = await decideRoute(
      { pathname: '/pipeline', search: '', sessionToken: null, headers: documentHeaders() },
      check,
    );
    expect(check).not.toHaveBeenCalled();
    expect(decision).toEqual({
      kind: 'redirect',
      location: '/login?next=%2Fpipeline',
      clearSession: false,
    });
  });

  it('raiz sem cookie → /login limpo (next=/ é o padrão)', async () => {
    const decision = await decideRoute(
      { pathname: '/', search: '', sessionToken: null, headers: documentHeaders() },
      checker('valid'),
    );
    expect(decision).toMatchObject({ location: '/login' });
  });

  it('/platform sem sessão válida também volta ao login', async () => {
    const decision = await decideRoute(
      {
        pathname: '/platform/workspaces',
        search: '',
        sessionToken: 'morto',
        headers: documentHeaders(),
      },
      checker('invalid'),
    );
    expect(decision).toMatchObject({ kind: 'redirect', clearSession: true });
  });

  it('sessão VÁLIDA → segue', async () => {
    const decision = await decideRoute(
      { pathname: '/hoje', search: '', sessionToken: 'bom', headers: documentHeaders() },
      checker('valid'),
    );
    expect(decision).toEqual({ kind: 'next' });
  });

  it('API fora do ar / lenta (unknown) → segue (fail-open; a API barra cada dado)', async () => {
    const decision = await decideRoute(
      { pathname: '/hoje', search: '', sessionToken: 'talvez', headers: documentHeaders() },
      checker('unknown'),
    );
    expect(decision).toEqual({ kind: 'next' });
  });

  it('pedido RSC / prefetch NÃO chama a API (a checagem é por documento)', async () => {
    const check = checker('invalid');
    for (const headers of [
      new Headers({ rsc: '1' }),
      new Headers({ 'next-router-prefetch': '1', rsc: '1' }),
    ]) {
      const decision = await decideRoute(
        { pathname: '/hoje', search: '', sessionToken: 'morto', headers },
        check,
      );
      expect(decision).toEqual({ kind: 'next' });
    }
    expect(check).not.toHaveBeenCalled();
  });
});

describe('decideRoute — telas públicas', () => {
  it.each(['/login', '/signup', '/reset-password', '/verify', '/termos', '/exclusao-de-dados/abc'])(
    '%s abre com ou sem cookie, sem chamar a API',
    async (pathname) => {
      const check = checker('invalid');
      const decision = await decideRoute(
        { pathname, search: '', sessionToken: 'morto', headers: documentHeaders() },
        check,
      );
      expect(decision).toEqual({ kind: 'next' });
      expect(check).not.toHaveBeenCalled();
    },
  );

  it('prefixo solto NÃO é público (/loginx exige sessão)', async () => {
    const decision = await decideRoute(
      { pathname: '/loginx', search: '', sessionToken: null, headers: documentHeaders() },
      checker('valid'),
    );
    expect(decision).toMatchObject({ kind: 'redirect' });
  });
});

describe('isDocumentRequest', () => {
  it('Sec-Fetch-Dest: document → true; image/empty → false', () => {
    expect(isDocumentRequest(new Headers({ 'sec-fetch-dest': 'document' }))).toBe(true);
    expect(isDocumentRequest(new Headers({ 'sec-fetch-dest': 'empty' }))).toBe(false);
  });

  it('Safari antigo sem Sec-Fetch-*: cai no Accept text/html', () => {
    expect(isDocumentRequest(new Headers({ accept: 'text/html,application/xhtml+xml' }))).toBe(
      true,
    );
    expect(isDocumentRequest(new Headers({ accept: '*/*' }))).toBe(false);
  });

  it('prefetch do navegador não conta como documento', () => {
    expect(isDocumentRequest(documentHeaders({ 'sec-purpose': 'prefetch' }))).toBe(false);
  });
});

describe('checkSession', () => {
  const opts = (impl: typeof fetch) => ({ apiBase: 'http://api:3001', fetchImpl: impl });

  it('200 → valid; manda o cookie para /api/me sem cache', async () => {
    const impl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await checkSession('tok', opts(impl as unknown as typeof fetch))).toBe('valid');
    expect(impl).toHaveBeenCalledWith(
      'http://api:3001/api/me',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ cookie: 'hm_session=tok' }),
      }),
    );
  });

  it('401 → invalid', async () => {
    const impl = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await checkSession('tok', opts(impl as unknown as typeof fetch))).toBe('invalid');
  });

  it('503 (provider fora) e 500 → unknown, nunca invalid', async () => {
    for (const status of [503, 500, 502]) {
      const impl = vi.fn(async () => new Response('{}', { status }));
      expect(await checkSession('tok', opts(impl as unknown as typeof fetch))).toBe('unknown');
    }
  });

  it('erro de rede → unknown', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await checkSession('tok', opts(impl as unknown as typeof fetch))).toBe('unknown');
  });

  it('API pendurada → aborta no teto e devolve unknown', async () => {
    const impl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const result = await checkSession('tok', {
      apiBase: 'http://api:3001',
      fetchImpl: impl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    expect(result).toBe('unknown');
  });
});

describe('open redirect — `next` só aceita caminho interno', () => {
  it.each([
    ['https://evil.com', '/'],
    ['http://evil.com/x', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['\\\\evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['data:text/html,x', '/'],
    ['/%0d%0aSet-Cookie:x', '/%0d%0aSet-Cookie:x'],
    ['/foo\nbar', '/'],
    ['evil.com', '/'],
    [null, '/'],
  ])('postLoginPath(%j) → %s', (raw, expected) => {
    expect(postLoginPath(raw)).toBe(expected);
  });

  it('caminho interno é preservado (com query e hash)', () => {
    expect(postLoginPath('/conversations?id=1#m')).toBe('/conversations?id=1#m');
  });

  it('next apontando para tela pública vira / (sem laço de volta ao login)', () => {
    expect(postLoginPath('/login')).toBe('/');
    expect(postLoginPath('/login?next=%2Fhoje')).toBe('/');
    expect(postLoginPath('/signup')).toBe('/');
  });

  it('loginUrl descarta next externo e mantém o motivo', () => {
    expect(loginUrl('//evil.com', true)).toBe('/login?motivo=sessao-expirada');
    expect(loginUrl('https://evil.com', false)).toBe('/login');
    expect(loginUrl('/login', true)).toBe('/login?motivo=sessao-expirada');
  });
});
