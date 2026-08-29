import { SectionLabel } from '@/components/layout/section-label';
import type { rightsTerms } from '@/db/schema';

export type RightsTermsRow = typeof rightsTerms.$inferSelect;

/** The card's heading, and the summary line once the terms are settled. */
export const USAGE_RIGHTS_TITLE = 'Usage Rights Agreement';
export const usageRightsVersionLabel = (version: string) =>
  `Version ${version}`;

/**
 * What the disclosure says while it is shut. Names the state — agreed — because
 * that is the creator's question once the offer is answered; "Usage Rights
 * Agreement" alone would read as something still to be done.
 */
export const USAGE_RIGHTS_AGREED_SUMMARY = 'Usage rights you agreed to';

/**
 * The usage-rights terms, rendered in full (AC-2, US-006).
 *
 * A server component, and deliberately in a different file from the agreement
 * checkbox: that one needs `'use client'`, and putting the directive at the top
 * of a shared file would make this static text a client component too. Same
 * reasoning as `<button className={buttonVariants({...})}>` on a server page —
 * a bundle shipped for something that never handles an event.
 *
 * The body is inline rather than behind a link or a dialog, which is what AC-2
 * means by "not behind a link they can skip". `max-h-64` scrolls a long body
 * within the page: the terms stay on screen and reachable, never one navigation
 * away.
 *
 * `whitespace-pre-wrap` is load-bearing. `RIGHTS_TERMS.body` is newline-joined
 * in `lib/config/pricing.ts`, and without it every paragraph collapses into a
 * single run-on block.
 *
 * **`collapsed` (KAN-200).** Once the offer is answered the terms are reference
 * material, and a full contract at the top of every later visit pushed the work —
 * the deliverable form, the review status — below the fold. Collapsed, they are a
 * native `<details>`: no client JS, no dialog primitive, still on the page rather
 * than behind a link, and one click from being read in full.
 *
 * Expanded is the default, and the decision moment is where AC-2 binds — a
 * creator being asked to agree sees the text without acting. So the caller passes
 * `collapsed` off the same predicate that gates the accept controls, and a
 * forgotten prop errs toward showing the terms rather than hiding them.
 */
export function UsageRightsCard({
  terms,
  collapsed = false,
}: {
  terms: RightsTermsRow;
  collapsed?: boolean;
}) {
  // One body, both states. Two copies of the scroll container and the
  // `whitespace-pre-wrap` would be two places for the same terms to render
  // differently from each other.
  //
  // Line comments, not a block: the source guards in `__tests__/usage-rights.test.ts`
  // strip JSX `{/* … */}` with a non-greedy match, and a `/* … */` opening right
  // after a `{` lets that match run on to the next `*/}` and swallow real code.
  const body = (
    <div className="max-h-64 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-50/80 p-5 text-sm leading-relaxed text-neutral-700">
      <p className="whitespace-pre-wrap">{terms.body}</p>
    </div>
  );

  if (collapsed) {
    return (
      <section className="rounded-[24px] border border-neutral-200 bg-background p-5 sm:p-6">
        {/* `<details>` and `<summary>`, not a button and a `useState`: the
            browser owns the open state, so this stays a server component and
            keyboard and screen-reader behaviour come for free. The marker is
            CSS on `group-open`, because `list-style` on a summary is what the
            default triangle rides on and removing it takes the affordance with
            it. */}
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 rounded-lg text-sm font-medium text-neutral-800 transition-colors duration-300 ease-out hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 active:text-neutral-900 marker:content-none">
            <span
              aria-hidden="true"
              className="text-muted-foreground transition-transform group-open:rotate-90"
            >
              ▸
            </span>
            <span>{USAGE_RIGHTS_AGREED_SUMMARY}</span>
            <span className="font-normal text-muted-foreground">
              {usageRightsVersionLabel(terms.version)}
            </span>
          </summary>
          <div className="pt-4">{body}</div>
        </details>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] border border-neutral-200 bg-background p-5 sm:p-6">
      <SectionLabel>{USAGE_RIGHTS_TITLE}</SectionLabel>
      {/* Shown, not merely recorded: a creator agreeing to terms is entitled
          to see which terms, and this is the version `deal.rights_terms_id`
          will point at for the life of the deal (AC-5). */}
      <p className="mt-3 text-sm text-muted-foreground">
        {usageRightsVersionLabel(terms.version)}
      </p>
      <div className="mt-4">{body}</div>
    </section>
  );
}
