import Link from 'next/link';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';

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
 * v4 conversion: the unavailable-deal state uses the creator workspace shell
 * and the shared ghost empty-feed grammar.
 */
export default function DealNotFound() {
  return (
    <BdShell className="bd-cr bd-cr-dealdetail">
      <BdPageHead
        eyebrow="Creator workspace"
        title="Deal unavailable"
        facts="The link may be out of date, or the deal may no longer be visible to this account."
        ruled
      />
      <div className="bd-emptyfeed">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5h14" />
          <path d="M6.5 7.5v10h11v-10" />
          <path d="M9 11h6" />
          <path d="M9 14h3" />
        </svg>
        <h3>This deal is not available</h3>
        <p>
          It may have been withdrawn, or the link may be out of date. Your other
          deals are still there.
        </p>
        <Link href="/creator/deals" className="bd-btn bd-btn--ghost">
          Back to your deals
        </Link>
      </div>
    </BdShell>
  );
}
