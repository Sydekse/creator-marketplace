import Link from 'next/link';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { Chip } from '@/components/ui/chip';
import { labelForStatus } from '@/lib/deals/groups';
import { dealStatusTone } from '@/lib/deals/status-tone';
import type {
  BrandInboxCampaign,
  BrandInboxDeal,
} from '@/lib/deals/brand-inbox';
import { formatEtb } from '@/lib/money';
import { displayTiktokHandle } from '@/lib/creators/handle';

/**
 * The brand's deals, grouped by campaign (§15).
 *
 * A server component: every row is a link and a handful of strings. The
 * grouping is by campaign, not by status, because a brand thinks in
 * campaigns — "what's happening with my X campaign?" is the natural question.
 *
 * Follows the `DealInbox` pattern (`components/deals/deal-inbox.tsx`) but with
 * campaign grouping instead of status grouping. The two share the same
 * vocabulary (`labelForStatus`, `dealStatusTone`) and the same design language
 * (links, status chips, `formatEtb`).
 */

function DealRow({ deal }: { deal: BrandInboxDeal }) {
  return (
    <li>
      <Link
        href={`/deals/${deal.id}`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-2 py-3 -mx-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex min-w-0 items-center gap-2">
          <InitialsAvatar name={deal.creatorHandle} size="sm" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
            {displayTiktokHandle(deal.creatorHandle)}
            </span>
            <div className="flex items-center gap-2">
              <Chip tone={dealStatusTone[deal.status] ?? 'gray'} size="sm">
                {labelForStatus(deal.status)}
              </Chip>
              <span className="text-xs text-muted-foreground">
                {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm tabular-nums">
            {formatEtb(deal.totalPrice)}
          </span>
          <span className="text-xs text-muted-foreground">View deal</span>
        </div>
      </Link>
    </li>
  );
}

function CampaignGroup({ group }: { group: BrandInboxCampaign }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">{group.campaignName}</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {group.count}
        </span>
      </div>

      <ul className="divide-y divide-border">
        {group.deals.map((deal) => (
          <DealRow key={deal.id} deal={deal} />
        ))}
      </ul>
    </section>
  );
}

export function BrandDealInbox({
  campaigns,
}: {
  campaigns: BrandInboxCampaign[];
}) {
  return (
    <div className="flex flex-col gap-8">
      {campaigns.map((group) => (
        <CampaignGroup key={group.campaignId} group={group} />
      ))}
    </div>
  );
}
