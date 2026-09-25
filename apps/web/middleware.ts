import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/shared/lib/session';
import { checkSession, decideRoute } from '@/shared/auth/route-guard';

/** Cookie de claim de view-as (espelha IMPERSONATION_COOKIE da API, F26-S05). */
const IMPERSONATION_COOKIE = 'hm_impersonation';

/**
 * Base da API vista pelo SERVIDOR web. Em produção é a rede interna do compose
 * (`API_PROXY_TARGET=http://api:3001`, a mesma dos rewrites); em dev, a API local.
 */
const API_BASE = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3001';

/**
 * Guarda de rota no edge (F70-S28). A decisão inteira mora em
 * `shared/auth/route-guard.ts`, testada; aqui só traduzimos `NextRequest` ↔ decisão.
 *
 * Rota protegida sem sessão VÁLIDA → redirect de servidor para `/login?next=<rota>`
 * (com `motivo=sessao-expirada` e o cookie morto apagado quando a sessão existia mas
 * morreu). `/platform/*` passa pela mesma guarda; o privilégio real
 * (is_platform_admin) é checado no layout e de novo na API (F25-S06).
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const decision = await decideRoute(
    {
      pathname,
      search,
      sessionToken: req.cookies.get(SESSION_COOKIE)?.value || null,
      headers: req.headers,
    },
    (token) => checkSession(token, { apiBase: API_BASE }),
  );

  if (decision.kind === 'redirect') {
    const res = NextResponse.redirect(new URL(decision.location, req.nextUrl.origin));
    // O servidor limpa o cookie morto: sem isso ele ficaria no navegador até o
    // maxAge (7 dias), e cada abertura repetiria a checagem só para chegar aqui.
    if (decision.clearSession) res.cookies.delete(SESSION_COOKIE);
    // Redirect de sessão nunca pode ser reaproveitado por cache (navegador, proxy, SW).
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const res = NextResponse.next();
  // View-as (F26-S09): propaga a presença do claim de impersonation p/ telemetria.
  // A sessão normal (hm_session) continua sendo a fonte de auth; o read-only é
  // imposto pela API.
  if (req.cookies.get(IMPERSONATION_COOKIE)?.value) res.headers.set('x-hm-impersonating', '1');
  return res;
}

export const config = {
  // Ignora assets estáticos e arquivos com extensão.
  // Exclui também os paths proxiados para a API (api/auth/socket.io) — quem
  // autentica lá é a própria API (401), não o redirect de página.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|auth/|socket.io|.*\\..*).*)'],
};
