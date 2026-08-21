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
import type { TierOutcome } from '@/lib/creators/tier-assignment';
import type { CreatorTier } from '@/lib/creators/queries';
import type { CreatorStatus } from '@/db/schema';

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
 * Untiered is not an error state. It is where a creator sits until an admin
 * prices them, and what to say about it depends on *why* they hold no tier:
 *
 * - **Pending verification.** No tier has been *computed* yet — assignment runs
 *   at approval (KAN-23). Telling such a creator they are "below our lowest tier"
 *   is simply false, so a pending creator sees a provisional preview instead: the
 *   band `selectTier` would put them in, run against the same rows assignment
 *   will read. The reason it is only a *preview* is that a person still has to
 *   confirm the handle first.
 * - **Rejected.** `VerificationStatus` already carries the rejection notice, so
 *   this block renders nothing rather than repeat it under a "your rate" heading.
 * - **Verified but untiered.** The genuine no-tier case, and the only one the
 *   "below our lowest tier" / missing-data copy is honest about. The reason comes
 *   from `missingTierFields` — the same rule that refused to assign a tier — so
 *   this block cannot name a field the rule is happy with.
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
      <dt className="text-sm text-neutral-400">{label}</dt>
      <dd className="flex items-baseline gap-2 text-right">
        <span
          className={
            emphasis
              ? 'font-mono text-base font-semibold text-neutral-50'
              : 'font-mono text-sm text-neutral-200'
          }
        >
          {value}
        </span>
        {note ? <span className="text-xs text-neutral-400">{note}</span> : null}
      </dd>
    </div>
  );
}

function PricingTable({ pricing }: { pricing: TierPricing }) {
  return (
    <dl className="divide-y divide-neutral-700">
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

/**
 * What a creator sees while still pending verification (KAN-24).
 *
 * A preview, not a promise: `outcome` is `selectTier` run over the same tier rows
 * assignment will read, so an admin approving them lands them on the very band
 * named here — but a person still has to confirm the handle, which is why the
 * copy leads with the review rather than the price. The tier name comes from the
 * outcome so this block quotes no band by name and no threshold; when nothing
 * matches (or a number is still missing) it stays silent on which, because the
 * definitive version of that message belongs to the verified case below.
 */
function Provisional({ outcome }: { outcome: TierOutcome }) {
  if (outcome.assigned) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          On track for the {outcome.tierName} tier.
        </p>
        <p className="text-sm text-muted-foreground">
          Brands can send you offers once a reviewer confirms your TikTok
          handle.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        We&rsquo;ll set your tier and price once a reviewer confirms your
        handle.
      </p>
      <p className="text-sm text-muted-foreground">
        Nothing is needed from you in the meantime.
      </p>
    </div>
  );
}

/**
 * Which block the pricing section shows, as a value rather than a render.
 *
 * Extracted for the reason `selectTier` and `missingTierFields` are: the branch
 * is the part worth testing, and it needs no DOM to test — this project renders
 * no components in its suite (`__tests__/ui-primitives.test.ts`). The reported
 * bug lived exactly here: a `pending_verification` creator with tier-clearing
 * numbers was falling through to the verified "below our lowest tier" copy, and
 * only a test of this decision can hold that shut.
 *
 * The order of the checks is the contract. `tier` wins outright — a priced
 * creator's copy never depends on their status. Rejection is silenced before the
 * provisional preview so a rejected creator (who has a `provisional` computed
 * like anyone else) is not shown "on track for" a tier they were turned down for.
 */
export type TierPricingView =
  | { kind: 'priced'; tier: CreatorTier }
  | { kind: 'hidden' }
  | { kind: 'provisional'; outcome: TierOutcome }
  | { kind: 'missing-data'; missing: readonly string[] }
  | { kind: 'below-tier' };

export function resolveTierPricingView(
  tier: CreatorTier | null,
  status: CreatorStatus,
  provisional: TierOutcome | null,
  profile: TierableProfile
): TierPricingView {
  if (tier !== null) return { kind: 'priced', tier };

  // A rejected creator's status is already spelled out by `VerificationStatus`
  // above; a second block headed "your rate" would only restate it.
  if (status === 'rejected') return { kind: 'hidden' };

  // Pending: no tier has been computed yet, so preview where they are heading
  // rather than the verified-case "below our lowest tier", which would be a lie.
  if (status === 'pending_verification' && provisional !== null) {
    return { kind: 'provisional', outcome: provisional };
  }

  // Verified but untiered — the genuine no-tier case. The reason comes from
  // `missingTierFields`, the same rule that refused to assign, so this cannot
  // name a field the rule was happy with (F13).
  const missing = missingTierFields(profile).map(missingFieldLabel);
  if (missing.length > 0) return { kind: 'missing-data', missing };
  return { kind: 'below-tier' };
}

export function TierPricing({
  tier,
  profile,
  status,
  provisional,
}: {
  tier: CreatorTier | null;
  /**
   * The creator's own numbers, needed only for the untiered case — a tiered
   * creator's price comes from the tier row, never from these.
   */
  profile: TierableProfile;
  /**
   * The creator's verification status, which decides what an *untiered* creator
   * is told: a pending creator has no tier because none has been computed yet,
   * not because they failed to qualify. Ignored when `tier` is set.
   */
  status: CreatorStatus;
  /**
   * The tier `selectTier` would assign on this creator's current numbers, for the
   * pending preview. Computed on the server (it needs the tier rows) and passed
   * in so this stays a leaf component. Null for a tiered creator, where it is
   * unused.
   */
  provisional: TierOutcome | null;
}) {
  const view = resolveTierPricingView(tier, status, provisional, profile);

  // Nothing to render for a rejected creator — see `resolveTierPricingView`.
  if (view.kind === 'hidden') return null;

  const heading = (
    <h2 className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
      Your rate
    </h2>
  );

  return (
    <section className="flex flex-col gap-4">
      {heading}
      {view.kind === 'priced' ? (
        <>
          <PricingTable pricing={priceForTier(view.tier)} />
          {/* Load-bearing, not a disclaimer out of habit: invariant 8 snapshots
              `deal.commission_rate` onto each deal at offer time, so the split
              above is the current rate rather than a promise about a future one. */}
          <p className="text-xs text-neutral-400">
            Your tier price and commission are confirmed on each offer you
            accept.
          </p>
        </>
      ) : null}

      {view.kind === 'provisional' ? (
        <Provisional outcome={view.outcome} />
      ) : null}

      {view.kind === 'missing-data' ? (
        <MissingData missing={view.missing} />
      ) : null}

      {view.kind === 'below-tier' ? (
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
      ) : null}
    </section>
  );
}
