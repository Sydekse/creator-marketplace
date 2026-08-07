import { formatEtb } from '@/lib/money';
import {
  formatCommissionRate,
  priceForTier,
  type TierPricing,
} from '@/lib/creators/pricing';
import {
  missingFieldLabel,
  missingTierFields,
  type TierableProfile,
} from '@/lib/creators/tier-rules';
import type { CreatorTier } from '@/lib/creators/queries';

/**
 * What a creator earns per video (KAN-24, US-002, AC-005).
 *
 * Replaces a Tier cell that said "Assigned" — true, and useless to a creator who
 * wanted to know their rate. Every figure here is derived by `priceForTier` from
 * the tier row a brand would be priced against, so the number the creator reads
 * and the number a brand is shown cannot be two different numbers.
 *
 * The commission is a line of its own rather than arithmetic already applied,
 * because AC-3 asks for it stated explicitly: a creator who sees only a net
 * figure has no way to tell a commission from a lower price.
 *
 * Untiered is not an error state. It is where a verified creator sits until an
 * admin prices them, and the reason comes from `missingTierFields` — the same
 * rule that refused to assign a tier — so this block cannot name a field the rule
 * is happy with.
 */

function Row({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2 text-right">
        <span
          className={
            emphasis ? 'font-mono text-base font-medium' : 'font-mono text-sm'
          }
        >
          {value}
        </span>
        {note ? (
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : null}
      </dd>
    </div>
  );
}

function PricingTable({ pricing }: { pricing: TierPricing }) {
  return (
    <dl className="divide-y divide-border">
      <Row label="Your tier" value={pricing.tierName} />
      <Row
        label="A brand pays"
        value={formatEtb(pricing.pricePerVideo)}
        note="per video"
      />
      {/* Negated for display only — `commission` is a positive amount withheld,
          and the sign is what makes it read as a deduction from the line above
          rather than a second thing a brand pays. */}
      <Row
        label="Platform commission"
        value={formatEtb(-pricing.commission)}
        note={formatCommissionRate(pricing.commissionRate)}
      />
      <Row
        label="You receive"
        value={formatEtb(pricing.payout)}
        note="per video"
        emphasis
      />
    </dl>
  );
}

function MissingData({ missing }: { missing: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        We need {missing.join(' and ')} before we can set your price.
      </p>
      <p className="text-sm text-muted-foreground">
        {/* No link. `/creator/onboarding` redirects away once a profile exists
            and there is no profile-edit route yet, so a link here would lead
            somewhere that bounces them straight back (logged as a follow-up).
            Naming the field without offering a button that does not work is the
            honest version. */}
        Email support with the {missing.join(' and ')} for your account and we
        will add {missing.length === 1 ? 'it' : 'them'} for you.
      </p>
    </div>
  );
}

export function TierPricing({
  tier,
  profile,
}: {
  tier: CreatorTier | null;
  /**
   * The creator's own numbers, needed only for the untiered case — a tiered
   * creator's price comes from the tier row, never from these.
   */
  profile: TierableProfile;
}) {
  const heading = (
    <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
      Your rate
    </h2>
  );

  if (tier !== null) {
    return (
      <section className="flex flex-col gap-4">
        {heading}
        <PricingTable pricing={priceForTier(tier)} />
        {/* Load-bearing, not a disclaimer out of habit: invariant 8 snapshots
            `deal.commission_rate` onto each deal at offer time, so the split
            above is the current rate rather than a promise about a future one. */}
        <p className="text-xs text-muted-foreground">
          Your tier price and commission are confirmed on each offer you accept.
        </p>
      </section>
    );
  }

  const missing = missingTierFields(profile).map(missingFieldLabel);

  return (
    <section className="flex flex-col gap-4">
      {heading}
      {missing.length > 0 ? (
        <MissingData missing={missing} />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Your audience is below our lowest tier right now.
          </p>
          {/* No thresholds quoted. Those are provisional Q2 values, and
              publishing a number a creator would then chase is a product
              decision nobody has made. */}
          <p className="text-sm text-muted-foreground">
            We reassess as your following and engagement grow, so this can
            change without you doing anything.
          </p>
        </div>
      )}
    </section>
  );
}
