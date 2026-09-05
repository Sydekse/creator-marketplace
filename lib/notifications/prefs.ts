import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { DEFAULT_EMAIL_PREFS } from './prefs-shared';
import type { EmailPrefKey, EmailPrefs } from './prefs-shared';
import type { NotificationType } from './types';

/**
 * Email notification preferences (settings page) — the server half.
 *
 * Four categories over seventeen types: a toggle per type is a chore nobody
 * finishes, and a new type gets a sensible default by joining a category.
 * These govern **email dispatch only** — the in-app `notification` row is
 * always written, so the bell and the feed stay complete.
 *
 * No row means everything on. The row is created lazily on first change.
 * Keys, defaults, and the page copy live in `./prefs-shared`, which client
 * components may import without pulling `pg` into their bundle.
 */

export {
  DEFAULT_EMAIL_PREFS,
  EMAIL_PREF_COPY,
  EMAIL_PREF_KEYS,
} from './prefs-shared';
export type { EmailPrefKey, EmailPrefs } from './prefs-shared';

/**
 * Which category each type belongs to. Exhaustive over `NotificationType` —
 * a new type fails the build here until it is filed, which is the point.
 */
export const TYPE_CATEGORY: Record<NotificationType, EmailPrefKey> = {
  offer_received: 'emailDeals',
  offer_accepted: 'emailDeals',
  offer_declined: 'emailDeals',
  offer_expired: 'emailDeals',
  deliverable_submitted: 'emailDeals',
  deliverable_approved: 'emailDeals',
  revision_requested: 'emailDeals',
  dispute_resolved: 'emailDeals',
  deadline_requested: 'emailDeals',
  deadline_accepted: 'emailDeals',
  deadline_rejected: 'emailDeals',
  deadline_withdrawn: 'emailDeals',
  campaign_funded: 'emailMoney',
  withdrawal_paid: 'emailMoney',
  withdrawal_failed: 'emailMoney',
  verification_result: 'emailAccount',
  tier_upgraded: 'emailAccount',
  tier_assigned: 'emailAccount',
  metric_reminder: 'emailReminders',
};

export async function readEmailPrefs(userId: string): Promise<EmailPrefs> {
  const [row] = await db
    .select({
      emailDeals: schema.notificationPref.emailDeals,
      emailMoney: schema.notificationPref.emailMoney,
      emailAccount: schema.notificationPref.emailAccount,
      emailReminders: schema.notificationPref.emailReminders,
    })
    .from(schema.notificationPref)
    .where(eq(schema.notificationPref.userId, userId))
    .limit(1);
  return row ?? DEFAULT_EMAIL_PREFS;
}

/** Lazily creates the row, then flips one category. */
export async function updateEmailPref(
  userId: string,
  key: EmailPrefKey,
  enabled: boolean
): Promise<void> {
  await db
    .insert(schema.notificationPref)
    .values({ userId, [key]: enabled })
    .onConflictDoUpdate({
      target: schema.notificationPref.userId,
      set: { [key]: enabled, updatedAt: new Date() },
    });
}

/**
 * The dispatch-side check: may this type reach this user's inbox?
 *
 * Fail-open by contract — a preferences read that throws must not stop a
 * deal email, so the caller treats an error as "allowed".
 */
export async function emailAllowed(
  userId: string,
  type: string
): Promise<boolean> {
  const key = TYPE_CATEGORY[type as NotificationType];
  if (!key) return true; // Unfiled type: deliver rather than silently drop.
  const prefs = await readEmailPrefs(userId);
  return prefs[key];
}
