import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { rightsTerms } from '@/db/schema';

export type RightsTermsRow = typeof rightsTerms.$inferSelect;

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
 */
export function UsageRightsCard({ terms }: { terms: RightsTermsRow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Rights Agreement</CardTitle>
        {/* Shown, not merely recorded: a creator agreeing to terms is entitled
            to see which terms, and this is the version `deal.rights_terms_id`
            will point at for the life of the deal (AC-5). */}
        <CardDescription>Version {terms.version}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 max-h-64 overflow-y-auto rounded-md border p-4 text-sm">
          <p className="whitespace-pre-wrap">{terms.body}</p>
        </div>
      </CardContent>
    </Card>
  );
}
