import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signUpSchema, signInSchema } from '../lib/validation/schemas';
import {
  TIKTOK_OAUTH_ERROR_MESSAGE,
  tiktokOAuthErrorMessage,
} from '../lib/tiktok-oauth-error';

const ROOT = join(__dirname, '..');

describe('signUpSchema', () => {
  const valid = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
    role: 'creator' as const,
  };

  it('accepts a valid sign-up payload', () => {
    const result = signUpSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts brand role', () => {
    const result = signUpSchema.safeParse({ ...valid, role: 'brand' });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = signUpSchema.safeParse({ ...valid, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = signUpSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '123' });
    expect(result.success).toBe(false);
  });

  it('rejects admin role sign-up', () => {
    const result = signUpSchema.safeParse({ ...valid, role: 'admin' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = signUpSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects undefined role', () => {
    const result = signUpSchema.safeParse({ ...valid, role: undefined });
    expect(result.success).toBe(false);
  });
});

describe('signInSchema', () => {
  const valid = {
    email: 'test@example.com',
    password: 'password123',
  };

  it('accepts a valid sign-in payload', () => {
    const result = signInSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = signInSchema.safeParse({ ...valid, email: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = signInSchema.safeParse({ ...valid, email: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = signInSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = signInSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TikTok Login Kit wiring', () => {
  it('registers TikTok only when both env keys exist', () => {
    const source = readFileSync(join(ROOT, 'lib/auth.ts'), 'utf8');
    expect(source).toContain('clientId: process.env.TIKTOK_CLIENT_KEY');
    expect(source).toContain('clientKey: process.env.TIKTOK_CLIENT_KEY');
    expect(source).toContain('TIKTOK_CLIENT_SECRET');
    expect(source).toContain('socialProviders');
  });

  it('maps every OAuth error code to one sentence and ignores blanks', () => {
    expect(tiktokOAuthErrorMessage('access_denied')).toBe(
      TIKTOK_OAUTH_ERROR_MESSAGE
    );
    expect(tiktokOAuthErrorMessage('invalid_code')).toBe(
      TIKTOK_OAUTH_ERROR_MESSAGE
    );
    expect(tiktokOAuthErrorMessage(null)).toBeNull();
    expect(tiktokOAuthErrorMessage('')).toBeNull();
    expect(tiktokOAuthErrorMessage('  ')).toBeNull();
  });

  it('sends error and first-time callback URLs on Continue with TikTok', () => {
    const cta = readFileSync(
      join(ROOT, 'components/auth/continue-with-tiktok.tsx'),
      'utf8'
    );
    expect(cta).toContain('errorCallbackURL');
    expect(cta).toContain("callbackURL: '/dashboard'");
    expect(cta).toContain("newUserCallbackURL: '/creator/credentials'");
    expect(cta).not.toContain('toast.error');

    const signUp = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/sign-up-card.tsx'),
      'utf8'
    );
    const signIn = readFileSync(
      join(ROOT, 'app/(auth)/sign-in/sign-in-form.tsx'),
      'utf8'
    );
    expect(signUp).toContain('errorCallbackURL="/sign-up"');
    expect(signUp).toContain("oauthError ? 'creator'");
    expect(signIn).toContain('errorCallbackURL="/sign-in"');
  });

  it('shows the TikTok handle on the credentials email step only', () => {
    const form = readFileSync(
      join(ROOT, 'app/(creator)/creator/credentials/credentials-form.tsx'),
      'utf8'
    );
    const page = readFileSync(
      join(ROOT, 'app/(creator)/creator/credentials/page.tsx'),
      'utf8'
    );
    expect(page).toContain('sessionTiktokHandle');
    expect(form).toContain("view === 'email' && tiktokHandle");
    expect(form).toContain('TikTokIcon');
    expect(form).toContain('displayTiktokHandle');
    expect(form).toContain('font-semibold');
  });

  it('offers Continue with TikTok on sign-up and sign-in', () => {
    const signUp = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/sign-up-card.tsx'),
      'utf8'
    );
    const signIn = readFileSync(
      join(ROOT, 'app/(auth)/sign-in/sign-in-form.tsx'),
      'utf8'
    );
    expect(signUp).toContain('ContinueWithTiktok');
    expect(signUp).toContain("role === 'creator'");
    expect(signIn).toContain('ContinueWithTiktok');

    const cta = readFileSync(
      join(ROOT, 'components/auth/continue-with-tiktok.tsx'),
      'utf8'
    );
    expect(cta).toContain('signIn.social');
  });

  it('requests the stats and video scopes for auto-fill (phase 2)', () => {
    const source = readFileSync(join(ROOT, 'lib/auth.ts'), 'utf8');
    expect(source).toContain('user.info.stats');
    expect(source).toContain('video.list');
  });

  it('gates the email creator path behind CREATOR_DEMO_SIGNUP, server-side', () => {
    // The UI only hides the form; the hook is what refuses the account. Both
    // halves read the same flag so they cannot disagree about what a
    // deployment allows.
    const source = readFileSync(join(ROOT, 'lib/auth.ts'), 'utf8');
    expect(source).toContain("process.env.CREATOR_DEMO_SIGNUP !== 'true'");
    const page = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/page.tsx'),
      'utf8'
    );
    expect(page).toContain("process.env.CREATOR_DEMO_SIGNUP === 'true'");
  });

  it('preselects the sign-up role from safe role query params only', () => {
    const page = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/page.tsx'),
      'utf8'
    );
    const card = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/sign-up-card.tsx'),
      'utf8'
    );

    expect(page).toContain('role?: string | string[]');
    expect(page).toContain("rawRole === 'creator' || rawRole === 'brand'");
    expect(page).toContain('initialRole={initialRole}');
    expect(card).toContain('initialRole?: RoleOption');
    expect(card).toContain("oauthError ? 'creator' : (initialRole ?? 'brand')");
  });

  it('wires the decorative auth panel to the sign-up role slider only', () => {
    const panel = readFileSync(join(ROOT, 'app/(auth)/auth-panel.tsx'), 'utf8');
    const card = readFileSync(
      join(ROOT, 'app/(auth)/sign-up/sign-up-card.tsx'),
      'utf8'
    );
    const layout = readFileSync(join(ROOT, 'app/(auth)/layout.tsx'), 'utf8');

    expect(panel).toContain('AUTH_ROLE_EVENT');
    expect(panel).toContain('SlotText');
    expect(panel).toContain("brand: {\n    top: 'Review first.'");
    expect(panel).toContain("creator: {\n    top: 'Accept with clarity.'");
    expect(card).toContain('new CustomEvent(AUTH_ROLE_EVENT');
    expect(layout).toContain('<AuthPanel />');
  });

  it('keeps auth route transitions scoped to the form card', () => {
    const transition = readFileSync(
      join(ROOT, 'app/(auth)/auth-route-transition.tsx'),
      'utf8'
    );
    const layout = readFileSync(join(ROOT, 'app/(auth)/layout.tsx'), 'utf8');
    expect(layout).toContain(
      '<AuthRouteTransition>{children}</AuthRouteTransition>'
    );
    expect(transition).toContain('usePathname');
    expect(transition).toContain('min-h-[40rem]');
    expect(transition).toContain('mode="wait"');
    expect(transition).toContain('10 * direction');
    expect(transition).not.toContain('clipPath');
    expect(transition).not.toContain('overflow-hidden');
    expect(transition).not.toContain('LayoutGroup');
  });
});
