import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { readVerificationQueue } from '@/lib/creators/verification-queue';
import { PAGE_SIZE, offsetForPage, pageFromParam } from '@/lib/paging';
import { VerificationQueue } from '@/components/admin/verification-queue';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin verification queue page (KAN-22).
 *
 * The queue is rendered server-side — Tech Spec §4.6 defines only the POST
 * verify endpoint, no GET queue route. `readVerificationQueue` embeds its own
 * admin gate (defense in depth) on top of the `(admin)` layout's role gate.
 *
 * Paging lives in the URL rather than in component state because this is a
 * Server Component: `?page=` is what re-runs the query. It also survives the
 * `router.refresh()` that follows every decision, so an admin working through
 * page 3 is still on page 3 after approving somebody.
 */
export default async function VerificationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const page = pageFromParam((await searchParams).page);
  const offset = offsetForPage(page);
  const { creators, hasMore } = await readVerificationQueue({
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Verification queue"
        description="Review creators awaiting verification. Approve to make them eligible for tier assignment, or reject with an optional note."
      />

      <VerificationQueue creators={creators} />

      {/* Shown whenever there is anywhere to go, including from a page past the
          end — an admin who lands on `?page=9` after the queue drained needs a
          way back, and the empty state on its own would tell them the queue is
          clear when it is not. */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {creators.length > 0
              ? `Showing ${offset + 1}–${offset + creators.length}`
              : `Nothing on page ${page}`}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin/verification?page=${page - 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            {hasMore && (
              <Link
                href={`/admin/verification?page=${page + 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
