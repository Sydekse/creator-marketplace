'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { RightsTermsRow } from '@/components/deals/usage-rights';

/**
 * Exact copy for the agreement control. Held as constants beside the component
 * that renders them, following `NO_MATCHES_TITLE` in `discovery.ts`: a string
 * defined once cannot be paraphrased apart from itself by a later edit, and the
 * text a creator agreed to is not something to restate loosely.
 */
export const AGREEMENT_LABEL =
  'I have read and agree to the Usage Rights terms';
export const AGREEMENT_HINT =
  'You must agree to these terms before accepting the deal offer.';

/**
 * The affirmative action that gates acceptance (AC-3, US-006).
 *
 * `'use client'` because of the checkbox — Base UI's is a client component, and
 * this takes an `onCheckedChange` function prop. A server page importing a
 * component with a function prop and no directive fails at render with
 * "Functions cannot be passed directly to Client Components".
 *
 * **Controlled, with no `defaultChecked`.** AC-3 requires the box cannot be
 * pre-checked, and the enforcement is that `checked` has no default here and no
 * default value at the call site: the parent must pass `false` to start. A
 * `defaultChecked` prop, or an optional `checked` falling back to anything,
 * would put a pre-ticked agreement one careless caller away.
 *
 * The parent owns the state because the parent owns the submit button it gates.
 * This component deliberately cannot accept the offer itself — an agreement
 * control that also submits is one that can be made to submit.
 */
export function UsageRightsAgreement({
  terms,
  checked,
  onCheckedChange,
}: {
  terms: RightsTermsRow;
  checked: boolean;
  // Base UI passes `(checked, eventDetails)`. Typed to match rather than to the
  // one-argument shape it is compatible with by arity, so a caller that needs
  // the event details can reach them instead of finding them silently absent.
  onCheckedChange: (
    checked: boolean,
    eventDetails: { readonly event: Event }
  ) => void;
}) {
  const id = `rights-agreement-${terms.version}`;

  return (
    <div className="bg-card flex flex-row items-start gap-3 rounded-md border p-4">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
      <div className="space-y-1 leading-none">
        {/* `htmlFor` is what makes the label a hit target for the checkbox — on
            a phone the box alone is a 16px tap target (NFR-007). */}
        <Label htmlFor={id} className="font-medium">
          {AGREEMENT_LABEL} (version {terms.version})
        </Label>
        <p className="text-muted-foreground text-sm">{AGREEMENT_HINT}</p>
      </div>
    </div>
  );
}
