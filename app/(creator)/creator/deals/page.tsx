import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { DealInbox } from '@/components/deals/deal-inbox';
import {
  INBOX_DESCRIPTION,
  INBOX_TITLE,
  readDealInbox,
} from '@/lib/deals/inbox';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * The creator's deal inbox (KAN-39, US-006, AC-1).
 *
 * Where the four "Review the offer →" links in `lib/notifications/templates.tsx`
 * land, and where the header's "My Deals" now points. The dashboard shows deals
 * as one section among several; this is the screen a creator opens to work
 * through offers, so it carries who is asking and by when.
 *
 * **AC-6 is `readDealInbox`'s, not this page's.** The layout's `requireRole`
 * above is the navigation gate — it redirects rather than throws, which is right
 * for someone following a link — and the read gates itself again inside the
 * module (NFR-005, invariant 2). This page cannot ask for another creator's
 * deals because the function takes no id to ask with.
 *
 * The clock is read once, here, and passed down. A `new Date()` inside the row
 * component would give two rows rendered either side of a deadline different
 * answers about the same instant, and it would make the expiry tense untestable
 * without freezing time globally.
 *
 * v4 conversion: shared `.bd` shell/header, with the inbox rows reskinned as a
 * compact ledger surface.
 */
export default async function CreatorDealsPage() {
  const inbox = await readDealInbox();
  // Null means the session has no creator profile yet — the pre-onboarding
  // state. Same funnel the dashboard uses.
  if (!inbox) redirect('/creator/onboarding');

  const now = new Date();

  const dealCount = inbox.groups.reduce(
    (total, group) => total + group.count,
    0
  );

  return (
    <BdShell className="bd-cr bd-cr-deals-page">
      <BdPageHead
        eyebrow="Creator workspace"
        title={INBOX_TITLE}
        facts={
          <>
            <span className="bd-mono">{dealCount}</span> total deals ·{' '}
            {INBOX_DESCRIPTION}
          </>
        }
        ruled
      />

      <section
        className="bd-cr-inboxwrap bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        {dealCount === 0 ? (
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 7.5h14" />
              <path d="M6.5 7.5v10h11v-10" />
              <path d="M9 11h6" />
              <path d="M9 14h4" />
            </svg>
            <h3>No deals yet</h3>
            <p>
              Offers from brands will appear here with their status, payout, and
              deadline once a campaign invites you.
            </p>
            <Link href="/creator" className="bd-btn bd-btn--ghost">
              Back to dashboard
            </Link>
          </div>
        ) : (
          <DealInbox groups={inbox.groups} now={now} />
        )}
      </section>
    </BdShell>
  );
}
