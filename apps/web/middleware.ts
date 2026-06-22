import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/shared/lib/session';

const PUBLIC_PREFIXES = ['/login', '/reset-password', '/signup', '/verify'];

/** Cookie de claim de view-as (espelha IMPERSONATION_COOKIE da API, F26-S05). */
const IMPERSONATION_COOKIE = 'hm_impersonation';

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  // View-as (F26-S09): reconhece o claim de impersonation no edge (aditivo). A sessao
  // normal (hm_session) continua sendo a fonte de auth; o read-only e imposto pela API
  // (middleware de impersonation). Aqui so propagamos a presenca do claim p/ telemetria
  // futura, sem regredir a auth de workspace nem o guard de /platform (F25).
  const isImpersonating = Boolean(req.cookies.get(IMPERSONATION_COOKIE)?.value);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Preserva o destino p/ pós-login. O valor vem do pathname interno (same-origin
    // por construção); o consumo no LoginForm ainda passa por safeNextPath (T11).
    const intended = req.nextUrl.pathname;
    url.search = '';
    if (intended && intended !== '/' && intended.startsWith('/') && !intended.startsWith('//')) {
      url.searchParams.set('next', intended);
    }
    return NextResponse.redirect(url);
  }
  // Camada de plataforma (F25-S06): exige sessao no edge (defesa primaria). O
  // privilegio real (is_platform_admin) e checado no layout server-side
  // (resolvePlatformAdmin) e de novo na API (requirePlatformAdmin). Aqui so
  // garantimos que ninguem sem sessao alcanca /platform/* — aditivo, nao
  // regride a auth de workspace.
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next();
  if (isImpersonating) res.headers.set('x-hm-impersonating', '1');
  return res;
}

export const config = {
  // Ignora assets estÃ¡ticos e arquivos com extensÃ£o.
  // Exclui tambÃ©m os paths proxiados para a API (api/auth/socket.io) â€” quem
  // autentica lÃ¡ Ã© a prÃ³pria API (401), nÃ£o o redirect de pÃ¡gina.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|auth/|socket.io|.*\\..*).*)'],
};
