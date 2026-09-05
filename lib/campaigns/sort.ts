/**
 * Sort vocabulary for the brand's campaign list — shared between the server
 * page (which orders the rows) and the client control (which renders the
 * top-nav-style slider). Plain module so both sides can import it.
 */

export type CampaignSortKey = 'newest' | 'budget' | 'progress' | 'name';

export const CAMPAIGN_SORTS: Array<{ key: CampaignSortKey; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'budget', label: 'Budget' },
  { key: 'progress', label: 'Progress' },
  { key: 'name', label: 'A–Z' },
];

export function isCampaignSortKey(value: unknown): value is CampaignSortKey {
  return CAMPAIGN_SORTS.some((s) => s.key === value);
}

export function sortCampaignRows<
  T extends {
    name: string;
    budget: number;
    committed: number;
    createdAt: Date | string;
  },
>(rows: T[], sort: CampaignSortKey): T[] {
  const sorted = [...rows];
  switch (sort) {
    case 'budget':
      sorted.sort((a, b) => b.budget - a.budget);
      break;
    case 'progress':
      sorted.sort((a, b) => {
        const pa = a.budget > 0 ? a.committed / a.budget : 0;
        const pb = b.budget > 0 ? b.committed / b.budget : 0;
        return pb - pa;
      });
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }
  return sorted;
}
