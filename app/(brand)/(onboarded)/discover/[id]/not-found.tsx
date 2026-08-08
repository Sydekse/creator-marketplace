import Link from 'next/link';
import { EmptyState } from '@/components/feedback/empty-state';
import { buttonVariants } from '@/components/ui/button';

/**
 * What a brand sees when `/discover/[id]` has no creator to show (KAN-29).
 *
 * Scoped to this segment rather than added at the app root, because the useful
 * thing to say here is specific: the creator is not bookable, and the way out is
 * back to the results. A root 404 would have to be generic enough to also cover
 * a mistyped marketing URL.
 *
 * Deliberately vague about *why*. `readCreatorDetail` returns `null` for a
 * malformed id, an id nobody holds, and a real creator who is pending, rejected
 * or un-tiered — all three land here, and saying which would turn this page into
 * a way to enumerate creators a brand is not allowed to see (AC-006).
 *
 * A `<Link>` styled with `buttonVariants`, never `<Button render={<Link/>}>` —
 * the latter announces a link as a button. See the note in
 * `app/(brand)/(onboarded)/brand/page.tsx`.
 */
export default function CreatorNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <EmptyState
        title="This creator is not available."
        description="They may not be taking bookings yet, or the link may be out of date. Your other results are still there."
        action={
          <Link
            href="/discover"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Back to results
          </Link>
        }
      />
    </div>
  );
}
