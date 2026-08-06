import { readVerificationQueue } from '@/lib/creators/verification-queue';
import { VerificationQueue } from '@/components/admin/verification-queue';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Admin verification queue page (KAN-22).
 *
 * The queue is rendered server-side — Tech Spec §4.6 defines only the POST
 * verify endpoint, no GET queue route. `readVerificationQueue` embeds its own
 * admin gate (defense in depth) on top of the `(admin)` layout's role gate.
 */
export default async function VerificationQueuePage() {
  const { creators } = await readVerificationQueue();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Verification queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Review creators awaiting verification. Approve to make them eligible
          for tier assignment, or reject with an optional note.
        </p>
      </div>
      <VerificationQueue creators={creators} />
    </div>
  );
}
