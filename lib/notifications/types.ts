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
 */
export const NOTIFICATION_TYPES = [
  'offer_received',
  'verification_result',
  'campaign_funded',
  'deliverable_submitted',
  'deliverable_approved',
  'revision_requested',
  'payout_sent',
  'dispute_resolved',
  'offer_expired',
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
  };
  revision_requested: {
    dealId: string;
    campaignTitle: string;
    /** The brand's note explaining what to change. */
    reason: string;
  };
  payout_sent: {
    dealId: string;
    campaignTitle: string;
    payout: number;
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
