'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UsageRightsAgreement } from '@/components/deals/usage-rights-agreement';
import type { RightsTermsRow } from '@/components/deals/usage-rights';
import { buttonVariants } from '@/components/ui/button';
import {
  ACCEPT_DEAL_LABEL,
  ACCEPT_FAILED_MESSAGE,
  ACCEPT_NEEDS_AGREEMENT_MESSAGE,
  ACCEPT_NETWORK_ERROR_MESSAGE,
  ACCEPT_SUCCESS_MESSAGE,
  ACCEPTING_LABEL,
  DECLINE_DEAL_LABEL,
  DECLINE_UNAVAILABLE_MESSAGE,
} from '@/lib/deals/copy';

/**
 * Accept and decline, for a deal that is actually `pending` (KAN-39 AC-3,
 * KAN-36 AC-017).
 *
 * `'use client'` because of the agreement checkbox: Base UI's `Checkbox` is a
 * client component and `UsageRightsAgreement` takes an `onCheckedChange`
 * function prop, which a server component cannot pass. This file is the smallest
 * thing that has to be a client component — `UsageRightsCard` is rendered by the
 * page above this, deliberately, so the terms body stays server-rendered instead
 * of being bundled along with the one control that needs an event handler.
 *
 * **The agreement state lives here because the button it gates lives here.**
 * `UsageRightsAgreement` is controlled with no `defaultChecked` and no fallback,
 * so the `useState(false)` below is what makes "cannot be pre-checked" true.
 * Passing anything but `false` as the initial value is the bug that component's
 * shape exists to prevent.
 *
 * **The tick is a convenience, not the enforcement.** The endpoint requires
 * `rights_terms_id` in the body and refuses the call without it (422), compares
 * it against the version currently in effect (409), and stamps its own read
 * rather than the value sent. Disabling this button stops an accident, not an
 * attacker — NFR-005, same as every other control in the app.
 *
 * Plain `<button>` with `buttonVariants`, not Base UI's `Button`: the styling is
 * all that is wanted here and the component is a second bundle for nothing.
 *
 * The copy comes from `lib/deals/copy.ts`, not `lib/deals/detail.ts`. That is not
 * a style choice — `detail.ts` imports `@/db` for its query, and a client
 * component importing from it fails the build with `Can't resolve 'util/types'`
 * as `pg` is pulled toward the browser. `detail.ts` re-exports the same constants
 * for server-side callers.
 */

export interface OfferActionsProps {
  dealId: string;
  /**
   * The terms to agree to — the version **currently** in effect, which is what
   * `readCreatorDeal` returns for a deal that can still be acted on. Agreeing to
   * anything else is what the endpoint's 409 exists to catch.
   */
  terms: RightsTermsRow | null;
}

export function OfferActions({ dealId, terms }: OfferActionsProps) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Nothing to agree to when the deal carries no terms row. The page renders the
  // missing-terms sentence in that case; the buttons still show, because AC-3 is
  // about the deal's status and not about its paperwork.
  const canAccept = agreed && terms !== null;

  async function handleAccept() {
    if (accepting || !canAccept || !terms) return;

    setAccepting(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The id of the version this screen actually displayed. The server
          // compares it against its own read; if the terms were republished
          // while this page sat open, that mismatch is the 409 below.
          body: JSON.stringify({ rightsTermsId: terms.id }),
        }
      );
    } catch {
      toast.error(ACCEPT_NETWORK_ERROR_MESSAGE);
      setAccepting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;
      // The server's own sentence. Every code this endpoint returns has one in
      // `ErrorMessage`, and those strings are acceptance criteria — restating
      // them here would create a second copy free to drift from the first.
      const message = body?.error?.message ?? ACCEPT_FAILED_MESSAGE;

      setAccepting(false);

      if (code === 'RIGHTS_TERMS_STALE') {
        // The one code with a behaviour rather than just a message. Refreshing
        // re-renders this page with the terms now in effect and an unticked box,
        // so the creator can read the new text and agree to *that*. Without the
        // refresh the reload would show the same stale body and 409 forever.
        toast.warning(message);
        setAgreed(false);
        router.refresh();
        return;
      }

      toast.error(message);

      // Every remaining failure is a disagreement about state — the offer lapsed,
      // or it was already answered in another tab. Re-reading the server's view
      // is what makes the screen stop offering an action that cannot succeed.
      router.refresh();
      return;
    }

    toast.success(ACCEPT_SUCCESS_MESSAGE);

    // The status, the history and whether these controls render at all are all
    // server-rendered from `deal.status`. Refreshing re-reads that rather than
    // patching a client copy that can disagree with it.
    setAccepting(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      {terms ? (
        <UsageRightsAgreement
          terms={terms}
          checked={agreed}
          onCheckedChange={(checked) => setAgreed(checked)}
        />
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={accepting || !canAccept}
          aria-describedby={terms && !agreed ? 'accept-note' : undefined}
          className={buttonVariants({ size: 'sm' })}
        >
          {accepting ? ACCEPTING_LABEL : ACCEPT_DEAL_LABEL}
        </button>
        {/* Declining needs no agreement — a creator refusing terms should not
            have to tick that they accept them first. Still disabled: the endpoint
            is KAN-37, a different branch in this wave. */}
        <button
          type="button"
          disabled
          aria-describedby="decline-note"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {DECLINE_DEAL_LABEL}
        </button>
      </div>

      {/* Linked by `aria-describedby` rather than merely adjacent, so a screen
          reader reaches the reason from the disabled control itself. Rendered
          only while it is true — a note explaining a button that is no longer
          disabled is worse than none, and "tick the box above" would be
          nonsense on a deal with no terms to tick. The page renders its own
          sentence for that case. */}
      {terms && !agreed ? (
        <p id="accept-note" className="text-sm text-muted-foreground">
          {ACCEPT_NEEDS_AGREEMENT_MESSAGE}
        </p>
      ) : null}
      <p id="decline-note" className="text-sm text-muted-foreground">
        {DECLINE_UNAVAILABLE_MESSAGE}
      </p>
    </section>
  );
}
