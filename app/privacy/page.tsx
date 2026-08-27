import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Creator Marketplace collects, uses, and stores account and TikTok data.',
  robots: { index: true, follow: true },
};

/**
 * Public privacy policy (TikTok Login Kit requirement).
 *
 * This is an operational document so a reviewer can crawl what we take from
 * TikTok and why. It is not a substitute for counsel.
 */
export default function PrivacyPage() {
  return (
    <LegalPage label="Legal" title="Privacy Policy" updated="27 August 2026">
      <section>
        <h2>Who we are</h2>
        <p>
          Creator Marketplace is a web service that connects brands with
          verified TikTok creators, holds campaign funds in escrow, and releases
          payment when a video is approved.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <p>Depending on how you use the service, we collect:</p>
        <ul>
          <li>
            Account details you give us: name, email address, password, and
            whether you signed up as a brand or a creator.
          </li>
          <li>
            Brand profile details: company name and campaign briefs you write.
          </li>
          <li>
            Creator profile details: TikTok handle, niche, audience notes, and
            any follower or engagement figures stored on your profile.
          </li>
          <li>
            Campaign, deal, delivery, and payment records needed to run escrow
            and payouts.
          </li>
        </ul>
      </section>

      <section>
        <h2>TikTok data</h2>
        <p>
          If you sign in or connect with TikTok Login Kit, TikTok may share data
          with us that you authorize. We use that data only to operate the
          marketplace:
        </p>
        <ul>
          <li>
            Profile: your TikTok username (handle), display name, and profile
            photo — so brands can identify you and we can confirm you own the
            account.
          </li>
          <li>
            Stats: follower count and related public account stats — so we can
            place you in a pricing tier without a manual admin check.
          </li>
          <li>
            Videos: a list of your public videos and per-video counts (views,
            likes, comments, shares) — so a brand can see performance of videos
            delivered on a campaign, instead of you typing those numbers by
            hand.
          </li>
        </ul>
        <p>
          We do not post to TikTok on your behalf, do not message other TikTok
          users, and do not sell TikTok data. Access tokens stay on our servers
          and are used only to refresh this information.
        </p>
      </section>

      <section>
        <h2>How we use data</h2>
        <ul>
          <li>Create and secure your account.</li>
          <li>Show creator profiles to brands and run campaigns and deals.</li>
          <li>Hold and release campaign funds and keep an audit trail.</li>
          <li>
            Send transactional email about offers, deliveries, and payouts.
          </li>
          <li>Detect abuse and meet legal obligations.</li>
        </ul>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep account and deal records for as long as your account is active
          and as long as we need them for payouts, disputes, or law. TikTok
          tokens are kept only while your TikTok account stays connected. You
          can ask us to delete your account; we will remove profile data we no
          longer need to keep for financial or legal records.
        </p>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          Brands see the creator profile and campaign performance they paid for.
          Creators see the brand name on offers. We use infrastructure providers
          (hosting, email, payments) as processors. We do not sell personal
          data.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about this policy: use the contact details on the live
          Creator Marketplace site, or write to the operator of this deployment.
        </p>
      </section>
    </LegalPage>
  );
}
