import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms for using Creator Marketplace as a brand or a creator.',
  robots: { index: true, follow: true },
};

/**
 * Public terms of service (TikTok Login Kit requirement).
 *
 * Operational, not a substitute for counsel. Enough for a reviewer to see
 * that the product is a marketplace with escrow, not a TikTok client that
 * posts or scrapes.
 */
export default function TermsPage() {
  return (
    <LegalPage label="Legal" title="Terms of Service" updated="27 August 2026">
      <section>
        <h2>The service</h2>
        <p>
          Creator Marketplace lets brands brief and fund TikTok creator
          campaigns, and lets creators accept offers, deliver videos, and get
          paid from escrow after approval. By creating an account or using the
          site you agree to these terms.
        </p>
      </section>

      <section>
        <h2>Accounts</h2>
        <ul>
          <li>
            You must give accurate information and keep your login safe. You are
            responsible for activity on your account.
          </li>
          <li>
            Brands and creators have different roles. You may not assign
            yourself an admin role.
          </li>
          <li>
            If you connect TikTok, you confirm you own that TikTok account and
            that TikTok&apos;s own terms still apply to your use of TikTok.
          </li>
        </ul>
      </section>

      <section>
        <h2>Campaigns, deals, and money</h2>
        <ul>
          <li>
            A brand funds a campaign; accepted offers are held until the brand
            approves the deliverable or a refund is issued under the product
            rules.
          </li>
          <li>
            Platform commission is shown on the deal. Payouts go to the creator
            net of that commission.
          </li>
          <li>
            You will not use the service for fraud, impersonation, or content
            that is illegal or that TikTok would not allow on its platform.
          </li>
        </ul>
      </section>

      <section>
        <h2>Content and TikTok</h2>
        <p>
          Creators keep ownership of the videos they post on TikTok. By
          delivering a video through a deal you grant the brand the usage rights
          described in the rights terms attached to that deal. We do not post to
          TikTok for you.
        </p>
      </section>

      <section>
        <h2>Availability</h2>
        <p>
          The service is provided as-is. We may change or suspend features. We
          are not liable for TikTok outages, declined payments, or losses beyond
          the amount paid through the platform for the affected deal.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: use the contact details on the live
          Creator Marketplace site, or write to the operator of this deployment.
        </p>
      </section>
    </LegalPage>
  );
}
