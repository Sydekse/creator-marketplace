import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DealHistory } from '@/components/deals/deal-history';
import { DeliverableForm } from '@/components/deals/deliverable-form';
import { OfferActions } from '@/components/deals/offer-actions';
import { UsageRightsCard } from '@/components/deals/usage-rights';
import { NO_EXPIRY_LABEL, expiryLabel, formatDeadlineUtc } from '@/lib/dates';
import { canAct, canDeliver } from '@/lib/deals';
import {
  COMMISSION_LABEL,
  DEAL_TERMS_TITLE,
  EXPECTED_PAYOUT_LABEL,
  FUNDS_HELD_LABEL,
  FUNDS_HELD_MESSAGE,
  NO_RIGHTS_TERMS_MESSAGE,
  OFFER_EXPIRY_LABEL,
  PAYOUT_ESTIMATE_NOTE,
  SUBMITTED_AT_LABEL,
  SUBMITTED_DELIVERABLE_LABEL,
  TOTAL_PRICE_LABEL,
  UNIT_PRICE_LABEL,
  VIDEO_COUNT_LABEL,
  readCreatorDeal,
} from '@/lib/deals/detail';
import { getDealHistory } from '@/lib/deals/queries';
import { formatEtb } from '@/lib/money';
import { isMoneyHeld } from '@/lib/payment/ledger';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One deal, in full, for the creator deciding on it (KAN-39, US-006, AC-2).
 *
 * `params` is a Promise and has to be awaited — the Next 16 shape, per
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
 *
 * **The two reads are sequential on purpose.** `readCreatorDeal` returns `null`
 * for every kind of miss and `getDealHistory` *throws* `ForbiddenError`, and this
 * app has no error boundary anywhere — running them together would turn a stale
 * link into an unstyled 500 instead of the not-found page beside this file. The
 * ownership check has to pass before the history is asked for, which is also the
 * order that makes the second call's guard a formality rather than the thing
 * standing between a stranger and this deal's audit trail.
 *
 * Nothing on this page computes money. `readCreatorDeal` already applied the
 * split using the deal's own snapshotted `commission_rate` (invariant 8), so the
 * only arithmetic-shaped call below is `formatEtb`.
 */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export default async function CreatorDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readCreatorDeal(id);
  if (!deal) notFound();

  const history = await getDealHistory(id);

  const isPending = canAct(deal.status);

  /*
   * The verb is only correct while the offer is still open. On an accepted or
   * completed deal the deadline is in the past by definition and was answered,
   * not missed — "Expired 3 Aug" would tell a creator their finished deal
   * lapsed. So the tense is spent on the one status where it means something,
   * and every other status shows the bare instant.
   */
  const deadline =
    deal.offerExpiresAt === null
      ? NO_EXPIRY_LABEL
      : isPending
        ? expiryLabel(deal.offerExpiresAt, new Date())
        : formatDeadlineUtc(deal.offerExpiresAt);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <Link
        href="/creator/deals"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to your deals
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {deal.campaignName}
        </h1>
        {/* AC-2's brand name: the trading name the brand publishes, never a
            contact (NFR-010). */}
        <p className="text-sm text-muted-foreground">{deal.companyName}</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
          {DEAL_TERMS_TITLE}
        </h2>
        {/* Two columns on a phone, three from `sm:` up (NFR-007). */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          <Fact label={VIDEO_COUNT_LABEL} value={String(deal.videoCount)} />
          <Fact label={UNIT_PRICE_LABEL} value={formatEtb(deal.unitPrice)} />
          <Fact label={TOTAL_PRICE_LABEL} value={formatEtb(deal.totalPrice)} />
          <Fact label={COMMISSION_LABEL} value={formatEtb(deal.commission)} />
          <Fact
            label={EXPECTED_PAYOUT_LABEL}
            value={formatEtb(deal.expectedPayout)}
          />
          <Fact label={OFFER_EXPIRY_LABEL} value={deadline} />
        </dl>
        {/* Labelled as an estimate, not decoration: a pending deal has no ledger
            rows, so this figure describes money that has not moved. KAN-25's
            AC-4 is why the dashboard's numbers are ledger sums instead. */}
        <p className="text-sm text-muted-foreground">{PAYOUT_ESTIMATE_NOTE}</p>
      </section>

      {/* AC-2's "full usage-rights terms", inline rather than behind a link.
          Rendered by the page, not by `OfferActions`, so this static body stays
          server-rendered instead of riding into the client bundle with the one
          control that needs an event handler.

          While the offer is open this is the version *currently* in effect, not
          the one stamped at offer time — `readCreatorDeal` swaps it, because
          acceptance must match the current version and agreeing to superseded
          text would be refused with a 409 no reload could clear. */}
      {deal.rightsTerms ? (
        <UsageRightsCard terms={deal.rightsTerms} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {NO_RIGHTS_TERMS_MESSAGE}
        </p>
      )}

      {/* KAN-43, AC-019 item 6 — the creator's half of "both parties can see
          that money is held".

          Gated on `isMoneyHeld`, which is `REFUNDABLE_FROM`: the ledger's own
          answer to "is there a live hold for this deal", derived from the list it
          refuses refunds against rather than a second list of statuses that could
          disagree with it. So this line appears exactly when a `hold` entry
          exists and has not been released, with no edit here if that set ever
          changes.

          Above the deliver button on purpose: the money being held is why the
          creator is willing to start work, so it comes before the control that
          starts it. */}
      {isMoneyHeld(deal.status) ? (
        <section className="flex flex-col gap-1 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{FUNDS_HELD_LABEL}</h2>
          <p className="font-mono text-sm">{formatEtb(deal.totalPrice)}</p>
          <p className="text-sm text-muted-foreground">{FUNDS_HELD_MESSAGE}</p>
        </section>
      ) : null}

      {/* AC-3. `canAct` reads `LEGAL_TRANSITIONS`, so these controls cannot
          outlive the rule that permits them — a status the machine stops
          accepting from stops rendering them here with no edit to this file. */}
      {isPending ? (
        <OfferActions dealId={deal.id} terms={deal.rightsTerms} />
      ) : null}

      {/* KAN-46, AC-022 — the deliverable submission path. `canDeliver` is
          `{funded, revision_requested}`, read off the same transition table as
          the accept controls: a funded deal is what the creator may deliver
          against, and a rejected one is what they may re-deliver against. The
          form is client-side — it holds the URL field and posts to
          `/api/deals/{id}/deliverable`. */}
      {canDeliver(deal.status) ? <DeliverableForm dealId={deal.id} /> : null}

      {/* What the creator submitted, once there is something to show. For a
          `revision_requested` deal this is the submission the brand sent back,
          sitting above the resubmit form so the creator can see what they are
          replacing. Shown as text, not a link: nothing here navigates or
          fetches (AC-8), and the brand-side "links to the live post" is
          KAN-49's. */}
      {deal.deliverable ? (
        <section className="flex flex-col gap-1 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{SUBMITTED_DELIVERABLE_LABEL}</h2>
          <p className="font-mono text-sm break-all">
            {deal.deliverable.tiktokUrl}
          </p>
          <p className="text-sm text-muted-foreground">
            {SUBMITTED_AT_LABEL}:{' '}
            {formatDeadlineUtc(deal.deliverable.submittedAt)}
          </p>
        </section>
      ) : null}

      {/* AC-5. Last on the page: it is the reference a creator scrolls to, not
          the thing they came for. */}
      <div className="border-t border-border pt-8">
        <DealHistory events={history} />
      </div>
    </div>
  );
}
