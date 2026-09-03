import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { headers } from 'next/headers';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { account, session } from '@/db/auth-schema';
import { BdShell, BdPageHead } from '@/components/brand/v4-shell';
import { auth, requireUser } from '@/lib/auth';
import { readEmailPrefs } from '@/lib/notifications/prefs';
import { NameForm } from './name-form';
import { PasswordForm } from './password-form';
import { PrefToggles } from './pref-toggles';
import { RevokeOthersButton, RevokeSessionButton } from './session-actions';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One settings page for every role (account, security, workspace,
 * connections, email preferences).
 *
 * Everything shown is the session user's own: sessions and linked accounts
 * are filtered by `user.id`, and the workspace chapter branches on the
 * session role — never on anything a request could claim.
 */

/** "Chrome on Windows" from a user-agent string — enough to recognise. */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

function formatWhen(date: Date): string {
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const PROVIDER_LABEL: Record<string, string> = {
  credential: 'Email and password',
  tiktok: 'TikTok',
};

const ROLE_EYEBROW: Record<string, string> = {
  brand: 'Brand workspace',
  creator: 'Creator workspace',
  admin: 'Admin console',
};

export default async function SettingsPage() {
  const user = await requireUser();

  // The raw session too — its token is what marks "this device" in the list.
  const live = await auth.api.getSession({ headers: await headers() });
  const currentToken = live?.session.token ?? null;

  const [sessions, accounts, prefs, brandProfile, creatorProfile] =
    await Promise.all([
      db
        .select({
          token: session.token,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
        })
        .from(session)
        .where(eq(session.userId, user.id))
        .orderBy(desc(session.updatedAt)),
      db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, user.id)),
      readEmailPrefs(user.id),
      user.role === 'brand'
        ? db
            .select({ companyName: schema.brandProfile.companyName })
            .from(schema.brandProfile)
            .where(eq(schema.brandProfile.userId, user.id))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      user.role === 'creator'
        ? db
            .select({
              tiktokHandle: schema.creatorProfile.tiktokHandle,
              niche: schema.creatorProfile.niche,
              status: schema.creatorProfile.status,
              followerCount: schema.creatorProfile.followerCount,
            })
            .from(schema.creatorProfile)
            .where(eq(schema.creatorProfile.userId, user.id))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

  const alive = sessions.filter((s) => s.expiresAt > new Date());
  const hasPassword = accounts.some((a) => a.providerId === 'credential');
  const memberSince = live?.user.createdAt
    ? new Date(live.user.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <BdShell>
      <BdPageHead
        eyebrow="Account"
        title="Settings"
        facts="Your identity, security, and how the marketplace reaches you."
        ruled
      />

      <div
        className="bd-stsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-stmain">
          {/* -- Identity -------------------------------------------------- */}
          <section className="bd-stsection">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">Identity</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulernote">How you appear here</span>
            </div>
            <div className="bd-strows">
              <NameForm initialName={user.name ?? ''} />
              <div className="bd-strow">
                <div className="bd-strowtext">
                  <span className="bd-strowk">Email</span>
                  <span className="bd-strowv bd-mono">{user.email}</span>
                </div>
                <span
                  className={
                    live?.user.emailVerified
                      ? 'bd-capstatus bd-capstatus--done'
                      : 'bd-capstatus bd-capstatus--wait'
                  }
                >
                  {live?.user.emailVerified ? 'Verified' : 'Unverified'}
                </span>
              </div>
              {user.tiktokHandle ? (
                <div className="bd-strow">
                  <div className="bd-strowtext">
                    <span className="bd-strowk">TikTok handle</span>
                    <span className="bd-strowv bd-mono">
                      @{user.tiktokHandle.replace(/^@/, '')}
                    </span>
                  </div>
                  <span className="bd-capstatus bd-capstatus--live">
                    Linked
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          {/* -- Security -------------------------------------------------- */}
          <section className="bd-stsection">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">Security</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulercount bd-mono">
                {alive.length} active{' '}
                {alive.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            <div className="bd-strows">
              {hasPassword ? (
                <PasswordForm />
              ) : (
                <div className="bd-strow">
                  <div className="bd-strowtext">
                    <span className="bd-strowk">Password</span>
                    <span className="bd-strown">
                      You sign in with TikTok. Set a password from the
                      credentials step to enable email sign-in.
                    </span>
                  </div>
                </div>
              )}

              <div className="bd-stsessions">
                <span className="bd-strowk">Active sessions</span>
                <ul className="bd-stsessionlist">
                  {alive.map((s) => {
                    const current = s.token === currentToken;
                    return (
                      <li key={s.token} className="bd-stsession">
                        <div className="bd-strowtext">
                          <span className="bd-strowv">
                            {describeAgent(s.userAgent)}
                            {current ? (
                              <span className="bd-stthis">This device</span>
                            ) : null}
                          </span>
                          <span className="bd-strown bd-mono">
                            {s.ipAddress || 'unknown IP'} · active{' '}
                            {formatWhen(s.updatedAt)}
                          </span>
                        </div>
                        {current ? null : (
                          <RevokeSessionButton token={s.token} />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {alive.length > 1 ? <RevokeOthersButton /> : null}
              </div>
            </div>
          </section>

          {/* -- Email preferences ---------------------------------------- */}
          <section className="bd-stsection">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">Email</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulernote">
                The bell always shows everything
              </span>
            </div>
            <div className="bd-strows">
              <PrefToggles initial={prefs} />
            </div>
          </section>
        </div>

        {/* -- The account rail ------------------------------------------- */}
        <aside className="bd-caprail bd-ctrail bd-dlrail">
          <div className="bd-railcell bd-railcell--hero">
            <span className="bd-railk">Signed in as</span>
            <span className="bd-railv">{user.name ?? user.email}</span>
            <span className="bd-railn">{ROLE_EYEBROW[user.role]}</span>
          </div>

          <div className="bd-railcell bd-ctledger">
            <span className="bd-railk">Account</span>
            <div className="bd-ctled">
              <div>
                <span>Role</span>
                <span className="bd-mono">{user.role}</span>
              </div>
            </div>
            {memberSince ? (
              <div className="bd-ctled">
                <div>
                  <span>Member since</span>
                  <span className="bd-mono">{memberSince}</span>
                </div>
              </div>
            ) : null}
            <div className="bd-ctled">
              <div>
                <span>Sign-in methods</span>
                <span className="bd-mono">
                  {accounts.length > 0
                    ? accounts
                        .map(
                          (a) => PROVIDER_LABEL[a.providerId] ?? a.providerId
                        )
                        .join(', ')
                    : 'None'}
                </span>
              </div>
            </div>
            {creatorProfile ? (
              <>
                <div className="bd-ctled">
                  <div>
                    <span>Verification</span>
                    <span className="bd-mono">
                      {creatorProfile.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                <div className="bd-ctled">
                  <div>
                    <span>Niche</span>
                    <span className="bd-mono">{creatorProfile.niche}</span>
                  </div>
                </div>
              </>
            ) : null}
            {brandProfile ? (
              <div className="bd-ctled">
                <div>
                  <span>Company</span>
                  <span className="bd-mono">{brandProfile.companyName}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Role-specific doors, not duplicated forms: the workspace pages
              own their own settings. */}
          <div className="bd-railcell bd-strailacts">
            {user.role === 'brand' ? (
              <Link href="/brand/settings" className="bd-btn bd-btn--ghost">
                Brand profile
              </Link>
            ) : null}
            {user.role === 'creator' ? (
              <Link
                href="/creator/credentials"
                className="bd-btn bd-btn--ghost"
              >
                Payout method
              </Link>
            ) : null}
            <Link href="/notifications" className="bd-btn bd-btn--ghost">
              Notification feed
            </Link>
          </div>
        </aside>
      </div>
    </BdShell>
  );
}
