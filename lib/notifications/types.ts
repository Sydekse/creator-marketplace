/**
 * Notification service types (KAN-54, Tech Spec §5).
 *
 * Two seams live here, for the same reason the payment code has one: the thing
 * that talks to the outside world is an interface, so the tests never send
 * email and the dev environment never reaches a real inbox (AC-6).
 */

/**
 * Every lifecycle point a user is told about (AC-2).
 *
 * This list is the acceptance criterion, one entry per point it names, in the
 * order it names them. `NOTIFICATION_TYPES` and this union are derived from one
 * array so a type added to one cannot go missing from the other — the count is
 * asserted in the tests, which is what makes "covers every lifecycle point"
 * checkable rather than a claim.
 *
 * `verification_result` carries its outcome in the payload rather than
 * splitting into approved/rejected types, because AC-2 names one lifecycle
 * point and AC-029 speaks of "the outcome". One point, one row, one email whose
 * body branches.
 *
 * The last two entries are the ones AC-2 does not name, and both are appended
 * rather than filed beside `offer_received`, so the nine the AC lists keep the
 * order it gives them:
 *
 * - `offer_accepted` (KAN-36 AC-8) — the brand has to know, because funding is
 *   their next move.
 * - `offer_declined` (KAN-37, AC-018) — AC-018 says the brand is notified, and
 *   `offer_expired` is not it. Both release the same money, but they are
 *   different facts: a creator said no, versus nobody answered. A brand may
 *   re-offer differently depending on which, and the two bodies read differently
 *   because of it.
 */
export const NOTIFICATION_TYPES = [
  'offer_received',
  'verification_result',
  'campaign_funded',
  'deliverable_submitted',
  'deliverable_approved',
  'revision_requested',
  'dispute_resolved',
  'offer_expired',
  'offer_accepted',
  'offer_declined',
  'metric_reminder',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What each notification carries.
 *
 * Deliberately thin (AC-5, NFR-010). These land in `notification.payload` as
 * jsonb *and* get rendered into an email, so anything here is data at rest in
 * two places. The rule applied throughout: identifiers and the few facts the
 * message actually states, never a copy of the counterparty's profile.
 *
 * Money is integer ETB santim (invariant 4) — never a formatted string, so the
 * stored row does not bake in a currency format, and never a float.
 *
 * **One vocabulary for the split, everywhere it appears** (KAN-55 AC-3/AC-4).
 * Two payloads state what a deal is worth and what the creator keeps, and both
 * use the same three names: `totalPrice` is the gross the brand owes,
 * `commission` is the platform's cut, `payout` is what reaches the creator.
 * `payout + commission === totalPrice` exactly, because every producer takes all
 * three from `computeSplit` rather than doing the arithmetic itself.
 *
 * **The added fields are optional, and that is about stored rows rather than
 * about the producers.** Every notification is also a `notification.payload`
 * jsonb row, and rows written before this ticket carry only their single figure.
 * Making the new fields required would not retro-fill them — it would only stop
 * the type describing what is actually in the table. The templates therefore
 * fall back to the one-figure sentence when they are absent, and the tests
 * assert each producer always sets them, which is where "required" belongs.
 */
export interface NotificationPayloadMap {
  offer_received: {
    dealId: string;
    campaignTitle: string;
    /** The brand offering — creators must know who (KAN-27 AC-3). */
    companyName: string;
    totalPrice: number;
    videoCount: number;
    offerExpiresAt: string;
    /**
     * AC-3: a creator decides on what they take home, not on the gross. Absent
     * on offers sent before KAN-55 — see the note above.
     */
    payout?: number;
    commission?: number;
  };
  verification_result: {
    creatorProfileId: string;
    outcome: 'approved' | 'rejected';
    /** Admin-supplied and shown to the creator; absent on approval. */
    reason?: string;
  };
  campaign_funded: {
    campaignId: string;
    campaignTitle: string;
    dealCount: number;
    totalHeld: number;
  };
  deliverable_submitted: {
    dealId: string;
    deliverableId: string;
    campaignTitle: string;
  };
  deliverable_approved: {
    dealId: string;
    campaignTitle: string;
    payout: number;
    /**
     * AC-4: the payment email states the gross and the deduction, not only the
     * net. Absent on approvals from before KAN-55.
     */
    totalPrice?: number;
    commission?: number;
  };
  revision_requested: {
    dealId: string;
    campaignTitle: string;
    /** The brand's note explaining what to change. */
    reason: string;
  };
  dispute_resolved: {
    dealId: string;
    campaignTitle: string;
    resolution: 'released' | 'refunded' | 'revision_requested';
  };
  offer_expired: {
    dealId: string;
    campaignTitle: string;
    /** Released back to the brand's available budget (AC-018). */
    releasedAmount: number;
    /**
     * The campaign the offer belonged to, so the mail can deep-link it (AC-2).
     * Optional for the reason above: rows written before KAN-55 have no id to
     * link with, and their CTA falls back to the campaign list.
     */
    campaignId?: string;
  };
  offer_accepted: {
    dealId: string;
    campaignId: string;
    campaignTitle: string;
    /**
     * The creator's TikTok handle — already public, and the one name the brand
     * recognises them by. Never their legal name or email (NFR-010).
     */
    creatorHandle: string;
    /** What the brand will owe on this deal, in santim (invariant 4). */
    totalPrice: number;
  };
  offer_declined: {
    dealId: string;
    campaignId: string;
    campaignTitle: string;
    /** Public handle only, for the reason given on `offer_accepted`. */
    creatorHandle: string;
    /**
     * Back in the brand's available budget, and equal to the deal's
     * `total_price` exactly (AC-018). Same field name as `offer_expired` — same
     * fact, so the same word.
     */
    releasedAmount: number;
  };
  metric_reminder: {
    dealId: string;
    campaignTitle: string;
  };
}

/** A type paired with its own payload — never one type's payload under another. */
export type NotificationInput = {
  [K in NotificationType]: { type: K; payload: NotificationPayloadMap[K] };
}[NotificationType];

/**
 * A rendered message, ready to send. No recipient — the provider is told who
 * separately, so a template can never smuggle an address into the body.
 */
export interface EmailMessage {
  subject: string;
  html: string;
  /** Plain-text alternative. Absent one, spam filters treat mail as suspect. */
  text: string;
}

/**
 * Outbound email, abstracted the way `PaymentProvider` abstracts the processor.
 *
 * The dev and test implementations are the point (AC-6): nothing in this repo
 * should be one missing env var away from mailing a real creator.
 */
export interface EmailProvider {
  /** Delivers to `to`, or throws. Throwing is how retry is triggered. */
  send(to: string, message: EmailMessage): Promise<EmailSendResult>;
  /** Names the implementation, for the dispatch log line. */
  readonly name: string;
}

export interface EmailSendResult {
  /** Provider-side id, when the provider gives one. */
  id: string | null;
}

/**
 * A send that failed.
 *
 * `permanent` is the whole reason this class exists. A bad address never
 * becomes a good one, so retrying it burns the bounded attempt budget that a
 * genuinely transient failure needs (AC-7).
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}
