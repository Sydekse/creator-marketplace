import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

/**
 * The proxy only reads cookie *presence*, so these tests are about routing, not
 * authorisation. The regression they exist to catch: Better Auth names the
 * cookie `better-auth.session_token`, and prefixes it with `__Secure-` when
 * cookies are secure. Matching on any other name silently signs everyone out.
 */

const DEV_COOKIE = 'better-auth.session_token';
const SECURE_COOKIE = '__Secure-better-auth.session_token';

function request(pathname: string, cookie?: string) {
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers: cookie ? { cookie } : {},
  });
}

function locationOf(response: Response) {
  return response.headers.get('location');
}

describe('proxy with no session', () => {
  it.each(['/brand', '/creator', '/admin', '/dashboard'])(
    'redirects %s to sign-in',
    (pathname) => {
      const location = locationOf(proxy(request(pathname)));
      expect(location).toContain('/sign-in');
    }
  );

  it('preserves the requested path so sign-in can return there', () => {
    const location = locationOf(proxy(request('/admin/verification')));
    expect(new URL(location!).searchParams.get('redirect')).toBe(
      '/admin/verification'
    );
  });

  it.each(['/sign-in', '/sign-up', '/'])('lets %s through', (pathname) => {
    expect(locationOf(proxy(request(pathname)))).toBeNull();
  });
});

describe('proxy with a session', () => {
  it.each([DEV_COOKIE, SECURE_COOKIE])(
    'recognises the %s cookie and allows a protected route',
    (name) => {
      const response = proxy(request('/brand', `${name}=abc123`));
      expect(locationOf(response)).toBeNull();
    }
  );

  it.each([DEV_COOKIE, SECURE_COOKIE])(
    'bounces %s away from the sign-in page',
    (name) => {
      const location = locationOf(proxy(request('/sign-in', `${name}=abc123`)));
      expect(location).toContain('/dashboard');
    }
  );

  it('still renders the landing page while signed in', () => {
    expect(locationOf(proxy(request('/', `${DEV_COOKIE}=abc123`)))).toBeNull();
  });

  it('does not accept a cookie named better-auth.session', () => {
    // The name the proxy originally matched on. Better Auth never sets it, so
    // treating it as a session would be matching on nothing.
    const location = locationOf(
      proxy(request('/brand', 'better-auth.session=abc123'))
    );
    expect(location).toContain('/sign-in');
  });
});
