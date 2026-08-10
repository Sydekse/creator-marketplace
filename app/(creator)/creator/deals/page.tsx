import { redirect } from 'next/navigation';
import { DealInbox } from '@/components/deals/deal-inbox';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  INBOX_DESCRIPTION,
  INBOX_TITLE,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
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
 */
export default async function CreatorDealsPage() {
  const inbox = await readDealInbox();
  // Null means the session has no creator profile yet — the pre-onboarding
  // state. Same funnel the dashboard uses.
  if (!inbox) redirect('/creator/onboarding');

  const now = new Date();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{INBOX_TITLE}</h1>
        <p className="text-sm text-muted-foreground">{INBOX_DESCRIPTION}</p>
      </div>

      {inbox.isEmpty ? (
        <EmptyState title={NO_DEALS_TITLE} description={NO_DEALS_DESCRIPTION} />
      ) : (
        <DealInbox groups={inbox.groups} now={now} />
      )}
    </div>
  );
}
