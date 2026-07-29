import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/sign-in', '/sign-up'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ROUTES.includes(pathname) || pathname === '/') {
    return NextResponse.next();
  }

  // Until KAN-16 wires Better Auth, the session check always returns null,
  // so every protected route redirects to sign-in. When auth lands, replace
  // this with a real session cookie check.
  const hasSession = request.cookies.has('better-auth.session');

  if (!hasSession) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
