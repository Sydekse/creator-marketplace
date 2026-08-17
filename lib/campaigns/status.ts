import type { ChipTone } from '@/components/ui/chip';

/**
 * Campaign status → chip tone (design doc §10.3). One mapping for every screen
 * that renders a campaign status, so a campaign cannot be gray on the admin
 * ledger and amber on the brand list. The vocabulary: teal/success for good
 * states, amber for waiting, gray for neutral. Cancelled is a terminal but not
 * a failure state, so it stays gray rather than red.
 */
export const campaignStatusTone: Record<string, ChipTone> = {
  draft: 'gray',
  confirmed: 'amber',
  funded: 'teal',
  in_progress: 'teal',
  completed: 'success',
  cancelled: 'gray',
};

/** Human label for a campaign status: `in_progress` → `In progress`. */
export function campaignStatusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}
