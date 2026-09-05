/**
 * The client-safe half of email notification preferences: keys, defaults,
 * and settings-page copy. No `pg` import — `app/settings/pref-toggles.tsx`
 * is a client component and must not drag the database into its bundle.
 * The queries live in `./prefs`.
 */

export const EMAIL_PREF_KEYS = [
  'emailDeals',
  'emailMoney',
  'emailAccount',
  'emailReminders',
] as const;

export type EmailPrefKey = (typeof EMAIL_PREF_KEYS)[number];

export interface EmailPrefs {
  emailDeals: boolean;
  emailMoney: boolean;
  emailAccount: boolean;
  emailReminders: boolean;
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  emailDeals: true,
  emailMoney: true,
  emailAccount: true,
  emailReminders: true,
};

/** What the settings page prints for each toggle. */
export const EMAIL_PREF_COPY: Record<
  EmailPrefKey,
  { label: string; detail: string }
> = {
  emailDeals: {
    label: 'Deal activity',
    detail: 'Offers, acceptances, submitted videos, reviews, and disputes.',
  },
  emailMoney: {
    label: 'Money movement',
    detail: 'Campaign funding and wallet withdrawals.',
  },
  emailAccount: {
    label: 'Account changes',
    detail: 'Verification results and pricing tier updates.',
  },
  emailReminders: {
    label: 'Reminders',
    detail: 'Scheduled nudges, like pending video metrics.',
  },
};
