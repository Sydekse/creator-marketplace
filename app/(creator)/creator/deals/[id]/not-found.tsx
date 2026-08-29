import Link from 'next/link';
import { EmptyState } from '@/components/feedback/empty-state';
import { buttonVariants } from '@/components/ui/button';

/**
 * What a creator sees when `/creator/deals/[id]` has no deal to show (KAN-39).
 *
 * Scoped to this segment rather than added at the app root, because the useful
 * thing to say here is specific: the deal is not theirs to read, and the way out
 * is back to the ones that are.
 *
 * Deliberately vague about *why*, and that is AC-6 rather than politeness.
 * `readCreatorDeal` returns `null` for a malformed id, an id nobody holds, and a
 * real deal belonging to another creator — all three land here, and saying which
 * would make the URL an existence oracle for deal ids (Tech Spec §6.3).
 *
 * A `<Link>` styled with `buttonVariants`, never `<Button render={<Link/>}>` —
 * the latter announces a link as a button. The `discover/[id]/not-found.tsx`
 * precedent.
 */
export default function DealNotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-3xl items-center py-8">
      <div className="w-full rounded-[24px] border border-neutral-200 bg-neutral-50 px-6 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.3)] sm:px-10">
        <EmptyState
          title="This deal is not available."
          description="It may have been withdrawn, or the link may be out of date. Your other deals are still there."
          action={
            <Link
              href="/creator/deals"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Back to your deals
            </Link>
          }
        />
      </div>
    </div>
  );
}
