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
  return NextResponse.next();
}

export const config = {
  // Ignora assets estáticos e arquivos com extensão.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
