import Link from 'next/link';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { labelForStatus } from '@/lib/deals/groups';
import type { DealStatus } from '@/db/schema';
import type {
  BrandInboxCampaign,
  BrandInboxDeal,
} from '@/lib/deals/brand-inbox';
import { formatEtb } from '@/lib/money';
import { TruncatedText } from '@/components/ui/truncated-text';
import { displayTiktokHandle } from '@/lib/creators/handle';
import { cn } from '@/lib/utils';

/**
 * The brand's deals, grouped by campaign (§15) — the v4 visual language:
 * each campaign is a rulered chapter and its deals are compact status-accented
 * cards in a responsive grid, so rows never stretch the full bleed.
 *
 * A server component: every card is a link and a handful of strings. The
 * grouping is by campaign, not by status, because a brand thinks in
 * campaigns — "what's happening with my X campaign?" is the natural question.
 *
 * Shares the deal vocabulary (`labelForStatus`) with the deal screen so the
 * two cannot call one state two things.
 */

/** Deal status → v4 chip tone + card accent, the campaigns pages' grammar. */
const DEAL_TONE: Partial<Record<DealStatus, string>> = {
  pending: 'bd-capstatus--wait',
  accepted: 'bd-capstatus--wait',
  funded: 'bd-capstatus--live',
  delivered: 'bd-capstatus--live',
  revision_requested: 'bd-capstatus--wait',
  completed: 'bd-capstatus--done',
  declined: 'bd-capstatus--dead',
  expired: 'bd-capstatus--dead',
  refunded: 'bd-capstatus--dead',
};

const DEAL_ACCENT: Partial<Record<DealStatus, string>> = {
  pending: 'bd-dicard--wait',
  accepted: 'bd-dicard--wait',
  funded: 'bd-dicard--live',
  delivered: 'bd-dicard--live',
  revision_requested: 'bd-dicard--wait',
  completed: 'bd-dicard--done',
};

function DealCard({ deal }: { deal: BrandInboxDeal }) {
  return (
    <li>
      <Link
        href={`/deals/${deal.id}`}
        className={cn('bd-dicard', DEAL_ACCENT[deal.status])}
      >
        <div className="bd-dicardhead">
          <InitialsAvatar
            name={deal.creatorHandle}
            image={deal.creatorImage}
            size="sm"
          />
          <TruncatedText
            text={displayTiktokHandle(deal.creatorHandle)}
            className="bd-dicardname"
          />
          <span
            className={cn(
              'bd-capstatus',
              DEAL_TONE[deal.status] ?? 'bd-capstatus--draft'
            )}
          >
            {labelForStatus(deal.status)}
          </span>
        </div>
        <div className="bd-dicardfoot">
          <span className="bd-dicardmoney bd-mono">
            {formatEtb(deal.totalPrice)}
            <span className="bd-factdim">
              {' '}
              · {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'}
            </span>
          </span>
          <span className="bd-dicardgo" aria-hidden="true">
            Open <span className="bd-dicardarrow">→</span>
          </span>
        </div>
      </Link>
    </li>
  );
}

function CampaignGroup({ group }: { group: BrandInboxCampaign }) {
  return (
    <section className="bd-disection">
      <div className="bd-capruler">
        <span className="bd-caprulertitle">{group.campaignName}</span>
        <span className="bd-caprulerline" aria-hidden="true" />
        <span className="bd-caprulercount bd-mono">
          {group.count} {group.count === 1 ? 'deal' : 'deals'}
        </span>
      </div>

      <ul className="bd-digrid">
        {group.deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
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
    <div className="bd-diwrap">
      {campaigns.map((group) => (
        <CampaignGroup key={group.campaignId} group={group} />
      ))}
    </div>
  );
}
