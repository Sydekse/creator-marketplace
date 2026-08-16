import { NOTIFICATION_TYPES } from './types';
import type { NotificationInput, NotificationType } from './types';

/**
 * One representative payload per notification type (KAN-55 AC-7).
 *
 * Lived in `__tests__/notifications.test.ts` until KAN-55 needed a second reader:
 * `scripts/preview-emails.ts` renders every one of these to a file so the
 * templates can be looked at without sending mail. Two copies of the fixtures
 * would drift, and the copy that drifted would be the one nobody renders — so
 * there is one, here, beside the templates it exercises.
 *
 * **The mapped type is the guard, not decoration.** `NotificationType` is derived
 * from `NOTIFICATION_TYPES`, so adding a type without adding a sample fails
 * `npm run typecheck`. That is what makes AC-1's "a template per type" hold going
 * forward: a new type cannot ship un-rendered, and therefore cannot ship
 * un-looked-at. The count assertion in the suite catches a *deleted* type; this
 * catches an added one.
 *
 * Money is integer santim (invariant 4) and the figures reconcile at the
 * provisional 15% of `COMMISSION_RATE` — 450,000 santim gross, 67,500
 * commission, 382,500 net. Not imported from config on purpose: a fixture that
 * tracks the live rate stops being a fixed thing to compare a render against,
 * and Q1 will move that number.
 *
 * Deliberately **not** re-exported from `./index`, which is the app's import
 * surface. Fixtures are for the preview script and the suite; the two things that
 * want them can name this module.
 */
export const SAMPLE_NOTIFICATIONS: {
  [K in NotificationType]: Extract<NotificationInput, { type: K }>;
} = {
  offer_received: {
    type: 'offer_received',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      companyName: 'Habesha Coffee',
      totalPrice: 450_000,
      videoCount: 3,
      offerExpiresAt: '2026-09-01T09:00:00.000Z',
      commission: 67_500,
      payout: 382_500,
    },
  },
  verification_result: {
    type: 'verification_result',
    payload: { creatorProfileId: 'c1', outcome: 'approved' },
  },
  campaign_funded: {
    type: 'campaign_funded',
    payload: {
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      dealCount: 2,
      totalHeld: 900_000,
    },
  },
  deliverable_submitted: {
    type: 'deliverable_submitted',
    payload: {
      dealId: 'd1',
      deliverableId: 'dl1',
      campaignTitle: 'Spring Coffee Push',
    },
  },
  deliverable_approved: {
    type: 'deliverable_approved',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      payout: 382_500,
      totalPrice: 450_000,
      commission: 67_500,
    },
  },
  revision_requested: {
    type: 'revision_requested',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      reason: 'Please show the packaging in the first three seconds.',
    },
  },
  dispute_resolved: {
    type: 'dispute_resolved',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      resolution: 'refunded',
    },
  },
  offer_expired: {
    type: 'offer_expired',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      releasedAmount: 150_000,
      campaignId: 'ca1',
    },
  },
  offer_accepted: {
    type: 'offer_accepted',
    payload: {
      dealId: 'd1',
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      creatorHandle: '@selam',
      totalPrice: 450_000,
    },
  },
  offer_declined: {
    type: 'offer_declined',
    payload: {
      dealId: 'd1',
      campaignId: 'ca1',
      campaignTitle: 'Spring Coffee Push',
      creatorHandle: '@selam',
      releasedAmount: 450_000,
    },
  },
  metric_reminder: {
    type: 'metric_reminder',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
    },
  },
};

/**
 * The same three emails as they arrive for a row written before KAN-55.
 *
 * These are not redundant with the map above: three payloads gained optional
 * money fields, and `notification.payload` rows already in the table do not have
 * them. The template falls back to its old one-figure sentence, and this is the
 * only way to *see* that fallback — a branch nobody renders is a branch nobody
 * has checked, and it is the branch every historical row takes.
 *
 * `offer_expired` is here for its CTA rather than its figures: without a
 * `campaignId` the mail links the campaign list instead of the campaign.
 */
export const LEGACY_SAMPLE_NOTIFICATIONS: readonly NotificationInput[] = [
  {
    type: 'offer_received',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      companyName: 'Habesha Coffee',
      totalPrice: 450_000,
      videoCount: 3,
      offerExpiresAt: '2026-09-01T09:00:00.000Z',
    },
  },
  {
    type: 'deliverable_approved',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      payout: 382_500,
    },
  },
  {
    type: 'offer_expired',
    payload: {
      dealId: 'd1',
      campaignTitle: 'Spring Coffee Push',
      releasedAmount: 150_000,
    },
  },
];

/** Every sample, in the order `NOTIFICATION_TYPES` gives, then the legacy ones. */
export function allSamples(): Array<{
  label: string;
  input: NotificationInput;
}> {
  return [
    ...NOTIFICATION_TYPES.map((type) => ({
      label: type as string,
      input: SAMPLE_NOTIFICATIONS[type] as NotificationInput,
    })),
    ...LEGACY_SAMPLE_NOTIFICATIONS.map((input) => ({
      label: `${input.type}--legacy`,
      input,
    })),
  ];
}
