import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/shared/lib/session';

const PUBLIC_PREFIXES = ['/login', '/reset-password'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
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

  return NextResponse.next();
}

export const config = {
  // Ignora assets estÃ¡ticos e arquivos com extensÃ£o.
  // Exclui tambÃ©m os paths proxiados para a API (api/auth/socket.io) â€” quem
  // autentica lÃ¡ Ã© a prÃ³pria API (401), nÃ£o o redirect de pÃ¡gina.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|auth/|socket.io|.*\\..*).*)'],
};
