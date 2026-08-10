'use client';

import { useState } from 'react';
import { UsageRightsAgreement } from '@/components/deals/usage-rights-agreement';
import type { RightsTermsRow } from '@/components/deals/usage-rights';
import { buttonVariants } from '@/components/ui/button';
import {
  ACCEPT_DEAL_LABEL,
  DECLINE_DEAL_LABEL,
  OFFER_ACTIONS_UNAVAILABLE_MESSAGE,
} from '@/lib/deals/copy';

/**
 * Accept and decline, for a deal that is actually `pending` (KAN-39, AC-3).
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
 * so the `useState(false)` below is what makes AC-3's "cannot be pre-checked"
 * true. Passing anything but `false` as the initial value is the bug that
 * component's shape exists to prevent.
 *
 * **Both controls are disabled, and they say why in a sentence.** The endpoints
 * are KAN-36 and KAN-37; neither exists yet. The AC names the controls, so the
 * controls are on screen and the sentence beside them explains it — never a
 * `title=` tooltip, which tells a touch user nothing. The `ADD_TO_CAMPAIGN_LABEL`
 * precedent, applied to a second surface.
 *
 * Plain `<button>` with `buttonVariants`, not Base UI's `Button`: the styling is
 * all that is wanted here and the component is a second bundle for nothing.
 *
 * The copy comes from `lib/deals/copy.ts`, not `lib/deals/detail.ts`. That is not
 * a style choice — `detail.ts` imports `@/db` for its query, and a client
 * component importing from it fails the build with `Can't resolve 'util/types'`
 * as `pg` is pulled toward the browser. `detail.ts` re-exports the same three
 * constants for server-side callers.
 */

/**
 * Whether there is anything to submit to. `false` until KAN-36 and KAN-37 ship
 * the endpoints.
 *
 * A named constant rather than a bare `disabled`, so the agreement gate below is
 * real code rather than a promise in a comment: when the endpoint lands, this
 * flips to `true` and `!canAccept` is already the thing standing between an
 * unticked box and an accepted deal. The alternative — enabling the button now —
 * would ship a control that looks ready and does nothing, which is worse than
 * one that explains itself.
 */
const ACTIONS_AVAILABLE = false;

export function OfferActions({ terms }: { terms: RightsTermsRow | null }) {
  const [agreed, setAgreed] = useState(false);

  // Nothing to agree to when the deal carries no terms row. The page renders the
  // missing-terms sentence in that case; the buttons still show, because AC-3 is
  // about the deal's status and not about its paperwork.
  const canAccept = agreed && terms !== null;

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
          disabled={!ACTIONS_AVAILABLE || !canAccept}
          aria-describedby="offer-actions-note"
          className={buttonVariants({ size: 'sm' })}
        >
          {ACCEPT_DEAL_LABEL}
        </button>
        {/* Declining needs no agreement — a creator refusing terms should not
            have to tick that they accept them first. */}
        <button
          type="button"
          disabled={!ACTIONS_AVAILABLE}
          aria-describedby="offer-actions-note"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {DECLINE_DEAL_LABEL}
        </button>
      </div>

      {/* Linked by `aria-describedby` rather than merely adjacent, so a screen
          reader reaches the reason from the disabled control itself. */}
      <p id="offer-actions-note" className="text-sm text-muted-foreground">
        {OFFER_ACTIONS_UNAVAILABLE_MESSAGE}
      </p>
    </section>
  );
}
