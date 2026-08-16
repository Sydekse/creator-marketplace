import Link from 'next/link';
import { EmptyState } from '@/components/feedback/empty-state';
import { buttonVariants } from '@/components/ui/button';

/**
 * What a brand sees when `/deals/[id]` has no deal to show (KAN-68).
 *
 * Scoped to this segment rather than added at the app root, because the useful
 * thing to say here is specific: the deal is not theirs to read, and the way out
 * is back to the campaigns that are.
 *
 * Deliberately vague about *why*, and that is AC-5 rather than politeness.
 * `readBrandDeal` returns `null` for a malformed id, an id nobody holds, and a
 * real deal on another brand's campaign — all three land here, and saying which
 * would make the URL an existence oracle for deal ids (Tech Spec §6.3). The
 * creator's `deals/[id]/not-found.tsx` is the mirror of this.
 *
 * A `<Link>` styled with `buttonVariants`, never `<Button render={<Link/>}>` —
 * the latter announces a link as a button.
 */
export default function BrandDealNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <EmptyState
        title="This deal is not available."
        description="It may have been withdrawn, or the link may be out of date. Your campaigns are still there."
        action={
          <Link
            href="/campaigns"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Back to campaigns
          </Link>
        }
      />
    </div>
  );
}
