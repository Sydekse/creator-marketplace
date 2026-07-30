import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_ROUTES = ['/sign-in', '/sign-up'];

/**
 * Coarse routing only: it redirects on the *presence* of a session cookie and
 * never on its contents. Cookie presence is not proof of a valid session, so
 * this is a UX shortcut, not a security boundary — the real gates are the
 * server-side `requireUser` / `requireRole` calls in each layout (NFR-005).
 *
 * `getSessionCookie` is used rather than a hand-written cookie name because
 * Better Auth prefixes the cookie with `__Secure-` whenever cookies are secure,
 * so the production name differs from the development one.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = getSessionCookie(request) !== null;

  if (pathname === '/') {
    return NextResponse.next();
  }

  if (AUTH_ROUTES.includes(pathname)) {
    if (hasSession) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

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
