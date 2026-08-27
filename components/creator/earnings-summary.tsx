import {
  EARNINGS_IN_ESCROW_LABEL,
  EARNINGS_NET_NOTE,
  EARNINGS_PAID_OUT_LABEL,
} from '@/lib/creators/dashboard';
import type { CreatorEarnings } from '@/lib/creators/dashboard';
import { formatEtb } from '@/lib/money';
import { SectionLabel } from '@/components/layout/section-label';

/**
 * What a creator has been paid and what is still held for them (KAN-25, AC-3).
 *
 * Both figures arrive already summed from the ledger. There is deliberately no
 * arithmetic in this file — not a commission rate, not a percentage, not a
 * multiplication. AC-4 requires the dashboard to read the ledger rather than
 * recompute its own totals, and the way to make that true of a component is for
 * it to have nothing to compute with. `formatEtb` is the only thing between the
 * summed santim and the screen (invariant 4).
 *
 * The two are shown side by side because they answer different questions and a
 * creator conflating them would be the expensive mistake: escrow is money a
 * brand has committed but that is not theirs until a deliverable is approved.
 * The label says "held", not "pending", for that reason.
 */

function Figure({
  label,
  value,
  note,
  compact,
}: {
  label: string;
  value: string;
  note: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      {/* Money is the one number a creator scans for, so it gets the serif
          display treatment the landing page gives its headline figures
          (design doc §4.3) — the same place a brand's eye goes on the hero. */}
      <dd
        className={
          compact
            ? 'mt-1 font-sans text-2xl font-semibold tracking-[-0.04em] text-brand-ink tabular-nums'
            : 'mt-1 font-sans text-3xl font-semibold tracking-[-0.04em] text-brand-ink tabular-nums'
        }
      >
        {value}
      </dd>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function EarningsSummary({
  earnings,
  headed = true,
}: {
  earnings: CreatorEarnings;
  headed?: boolean;
}) {
  return (
    <div className={headed ? 'flex flex-col gap-6' : 'flex flex-col gap-4'}>
      {headed ? <SectionLabel>Earnings</SectionLabel> : null}

      {/* Stacked on a phone, two up from `sm:` — no fixed widths, nothing that
          scrolls sideways (NFR-007). */}
      <dl className="grid gap-5 sm:grid-cols-2 sm:divide-x sm:divide-neutral-200">
        <Figure
          compact={!headed}
          label={EARNINGS_PAID_OUT_LABEL}
          value={formatEtb(earnings.paidOut)}
          note="Released to you on approved deliverables."
        />
        <div className="sm:pl-6">
          <Figure
            compact={!headed}
            label={EARNINGS_IN_ESCROW_LABEL}
            value={formatEtb(earnings.inEscrow)}
            note="Committed by brands, released when work is approved."
          />
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">{EARNINGS_NET_NOTE}</p>
    </div>
  );
}
