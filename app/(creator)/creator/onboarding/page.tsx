import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { needsCredentials, requireRole } from '@/lib/auth';
import { sessionTiktokHandle } from '@/lib/creators/credentials';
import { getCreatorProfileByUserId } from '@/lib/creators/queries';
import { fetchTiktokStats } from '@/lib/tiktok/stats';
import { CreatorOnboardingForm } from './creator-onboarding-form';

/**
 * Creator onboarding (US-001, AC-001).
 *
 * The redirect is a convenience, not a control: `creator_profile.user_id` is
 * unique, so a creator who reaches the endpoint directly gets a 409 regardless
 * of what this page does. Sending them to their dashboard just means they never
 * see a form that cannot succeed.
 *
 * v4 conversion: the application uses the creator workspace shell, ruled
 * masthead, and a rail-card preview while keeping the form payload untouched.
 */
export default async function CreatorOnboardingPage() {
  const user = await requireRole('creator');
  // Login Kit first, credentials second: a TikTok sign-up has no real email
  // until that step, so onboarding cannot start on the synthetic one.
  if (needsCredentials(user)) redirect('/creator/credentials');

  const profile = await getCreatorProfileByUserId(user.id);
  if (profile) redirect('/creator');

  // The DB read, not the session cache: the session's `tiktokHandle` can lag
  // the row the create.before hook wrote (phase 1 fix in #130).
  const lockedHandle =
    (await sessionTiktokHandle(user.id)) ?? user.tiktokHandle ?? null;

  // Live numbers from the TikTok API, for display only — the POST re-reads
  // them server-side, so nothing shown here is trusted on the way back in.
  // Null (email sign-up, missing scope, API down) leaves the manual fields.
  const stats = lockedHandle ? await fetchTiktokStats(user.id) : null;

  return (
    <BdShell className="bd-cr bd-cr-onboarding">
      <BdPageHead
        eyebrow="Creator workspace"
        title="Build your creator profile"
        facts="Tell brands what you create and who watches it. Your profile goes live immediately and becomes searchable once a pricing tier matches your numbers."
        ruled
      />

      <div
        className="bd-cr-onboardsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <aside className="bd-caprail bd-cr-onboardrail">
          <div className="bd-railcell">
            <span className="bd-railk">What brands will see</span>
            <span className="bd-railv">Profile signal</span>
            <span className="bd-railn">
              The marketplace reads your niche, audience, and performance as a
              bookable rate card.
            </span>
          </div>
          <div className="bd-railcell bd-cr-onboardcheck">
            <span>TikTok account and niche</span>
            <span>Top audience markets and age</span>
            <span>
              {lockedHandle
                ? 'Performance figures pulled from TikTok'
                : 'Optional performance figures for tier review'}
            </span>
          </div>
          <p className="bd-railfoot">
            Use the same account brands should evaluate before sending an offer.
          </p>
        </aside>

        <section className="bd-briefcard bd-cr-formcard bd-cr-onboardform">
          <CreatorOnboardingForm
            lockedHandle={lockedHandle}
            lockedStats={stats}
          />
        </section>
      </div>
    </BdShell>
  );
}
