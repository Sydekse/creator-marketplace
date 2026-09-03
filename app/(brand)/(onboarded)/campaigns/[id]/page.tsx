import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  MagnifyingGlass,
  PencilSimple,
} from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { readCampaignBudget } from '@/lib/campaigns/budget';
import { listCartItems } from '@/lib/campaigns/cart-queries';
import {
  HELD_IN_ESCROW_LABEL,
  HELD_IN_ESCROW_NOTE,
} from '@/lib/campaigns/constants';
import { readCampaignEscrow } from '@/lib/campaigns/escrow';
import {
  COMMISSION_LABEL,
  EMPTY_PERFORMANCE,
  PAID_OUT_LABEL,
  REFUNDED_LABEL,
  REFUNDED_NOTE,
  SETTLEMENT_NOTE,
  readCampaignPerformance,
} from '@/lib/campaigns/performance';
import { campaignStatusLabel } from '@/lib/campaigns/status';
import {
  countAcceptedDeals,
  getCampaignForBrand,
  sumContractedVideos,
} from '@/lib/campaigns/queries';
import { getOpenFundingSession } from '@/lib/campaigns/fund-session';
import { paymentUxMode } from '@/lib/payment/gateway';
import { formatEtb } from '@/lib/money';

import { CancelCampaignButton } from '@/components/campaign/cancel-campaign-button';
import { ConfirmCampaignButton } from '@/components/campaign/confirm-campaign-button';
import { FundCampaignButton } from '@/components/campaign/fund-campaign-button';
import { FundCheckoutButton } from '@/components/campaign/fund-checkout-button';
import { PendingPaymentBanner } from '@/components/campaign/pending-payment-banner';
import { RemoveFromCartButton } from '@/components/campaign/remove-from-cart-button';
import { VideoPerformance } from '@/components/campaign/video-performance';
import { TruncatedText } from '@/components/ui/truncated-text';
import type { CampaignStatus } from '@/db/schema';
import { cn, textLinkFeedback } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Campaign detail: the cart while it is a draft, the live deals and their
 * performance once it is not (KAN-30, KAN-68, KAN-49) — rendered in the v4
 * visual language: the money summary rides the rail-card grammar and cart
 * rows carry the status left-accent.
 *
 * **No money is computed here.** Every figure arrives summed from the ledger or
 * from `readCampaignBudget`, and `formatEtb` is the only arithmetic-shaped call in
 * the file (AC-026, invariant 4).
 */

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: 'bd-capstatus--draft',
  confirmed: 'bd-capstatus--wait',
  funded: 'bd-capstatus--live',
  in_progress: 'bd-capstatus--live',
  completed: 'bd-capstatus--done',
  cancelled: 'bd-capstatus--dead',
};

function LedgerRow({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className={cn('bd-ctled', strong && 'bd-ctled--strong')}>
      <div>
        <span>{label}</span>
        <span className="bd-mono">{value}</span>
      </div>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

export default async function CampaignCartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaign = await getCampaignForBrand(id, profile.id);
  if (!campaign) notFound();

  const settled = campaign.status !== 'draft';
  // Which money rails the fund control drives (KAN-70): `mock` funds in one
  // POST; anything else leaves for Chapa's hosted checkout, and a campaign
  // with an open checkout shows the resume/cancel banner instead of a button.
  const uxMode = paymentUxMode();
  // Ordered so the draft-only-block assertion in cancel-campaign.test.ts keeps
  // its anchor: the page's first `campaign.status === 'confirmed' &&` must
  // remain the JSX action block, not this flag.
  const chapaMode = uxMode !== 'mock' && campaign.status === 'confirmed';

  const [
    items,
    budget,
    escrowed,
    acceptedCount,
    performance,
    openSession,
    contractedVideos,
  ] = await Promise.all([
    listCartItems(campaign.id),
    readCampaignBudget(campaign.id),
    settled ? readCampaignEscrow(campaign.id) : Promise.resolve(0),
    settled ? countAcceptedDeals(campaign.id) : Promise.resolve(0),
    settled
      ? readCampaignPerformance(campaign.id)
      : Promise.resolve(EMPTY_PERFORMANCE),
    chapaMode ? getOpenFundingSession(campaign.id) : Promise.resolve(null),
    // Drafts have no deals by definition — skip the query, not just the label.
    campaign.status === 'draft'
      ? Promise.resolve(0)
      : sumContractedVideos(campaign.id),
  ]);

  const { committed, available } = budget ?? {
    committed: 0,
    available: campaign.budget,
  };

  const created = new Date(campaign.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <BdShell>
      <div className="bd-rise" style={{ '--i': 0 } as React.CSSProperties}>
        <Link href="/campaigns" className="bd-cdback">
          <ArrowLeft size={16} weight="regular" aria-hidden />
          Back to campaigns
        </Link>
      </div>

      <div
        className="bd-ctsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-ctmain">
          <header className="bd-cthead">
            <p className="bd-eyebrow">Campaign</p>
            <h1 className="bd-h1">{campaign.name}</h1>
            <p className="bd-idfacts">
              <span
                className={cn('bd-capstatus', STATUS_TONE[campaign.status])}
              >
                {campaignStatusLabel(campaign.status)}
              </span>
              <span className="bd-idfactsep" aria-hidden="true">
                ·
              </span>
              <span>Opened {created}</span>
              <span className="bd-idfactsep" aria-hidden="true">
                ·
              </span>
              <b className="bd-mono">
                {contractedVideos > 0
                  ? `${contractedVideos} of ${campaign.desiredVideos} videos contracted`
                  : `${campaign.desiredVideos} videos planned`}
              </b>
            </p>
            {campaign.goal ? (
              <p className="bd-ctgoal">{campaign.goal}</p>
            ) : null}
            {campaign.status === 'draft' && (
              <div className="bd-ctacts">
                <Link
                  href={`/campaigns/${campaign.id}/edit`}
                  className="bd-btn bd-btn--ghost"
                >
                  <PencilSimple size={14} weight="regular" aria-hidden />
                  Edit brief
                </Link>
                <Link href="/discover" className="bd-btn bd-btn--ghost">
                  <MagnifyingGlass size={14} weight="regular" aria-hidden />
                  Find creators
                </Link>
                <ConfirmCampaignButton
                  campaignId={campaign.id}
                  itemCount={items.length}
                />
                <CancelCampaignButton
                  campaignId={campaign.id}
                  campaignName={campaign.name}
                />
              </div>
            )}
          </header>

          {settled ? (
            <VideoPerformance
              deals={performance.deals}
              totals={performance.totals}
            />
          ) : (
            <>
              <div className="bd-capruler">
                <span className="bd-caprulertitle">Cart</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  Creators lined up for this campaign
                </span>
                <span className="bd-caprulercount bd-mono">
                  {items.length} {items.length === 1 ? 'creator' : 'creators'}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="bd-emptyfeed">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="9" cy="19" r="1.6" />
                    <circle cx="17" cy="19" r="1.6" />
                    <path d="M3 4.5h2.4l2.2 10.2A1.5 1.5 0 0 0 9.07 16h8.1a1.5 1.5 0 0 0 1.46-1.16L20.5 8H6" />
                  </svg>
                  <h3>Your cart is empty</h3>
                  <p>
                    Browse the marketplace to find creators and add them to this
                    campaign.
                  </p>
                  <Link className="bd-btn bd-btn--primary" href="/discover">
                    Browse creators
                  </Link>
                </div>
              ) : (
                <ul className="bd-cartgrid">
                  {items.map((item, index) => (
                    <li key={item.id} className="bd-cartcard">
                      <div className="bd-cartcardhead">
                        <span className="bd-capidx bd-mono">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <InitialsAvatar
                          name={item.creator.tiktokHandle}
                          image={item.creator.image}
                          size="sm"
                        />
                        <div className="bd-cartwho">
                          <div>
                            <Link
                              href={`/discover/${item.creatorId}`}
                              className={cn('min-w-0', textLinkFeedback)}
                            >
                              <TruncatedText
                                text={item.creator.tiktokHandle}
                                className="bd-cthandle"
                              />
                            </Link>
                            {item.tier?.id ? (
                              <span className="bd-disctier">
                                {item.tier.name}
                              </span>
                            ) : null}
                          </div>
                          <TruncatedText
                            text={item.creator.niche}
                            className="bd-ctniche"
                          />
                        </div>
                        <RemoveFromCartButton
                          campaignId={campaign.id}
                          creatorId={item.creatorId}
                          creatorHandle={item.creator.tiktokHandle}
                        />
                      </div>
                      <div className="bd-cartcardfoot">
                        <span className="bd-cartmath bd-mono">
                          {formatEtb(item.unitPrice)} × {item.videoCount}
                        </span>
                        <span className="bd-carttotal bd-mono">
                          {formatEtb(item.totalPrice)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <aside className="bd-caprail bd-ctrail bd-dlrail">
          <div className="bd-railcell bd-railcell--hero">
            <span className="bd-railk">Remaining</span>
            <span className="bd-railv bd-mono">{formatEtb(available)}</span>
            <span className="bd-railn">of the campaign budget</span>
          </div>

          <div className="bd-railcell bd-ctledger">
            <span className="bd-railk">Budget</span>
            <LedgerRow
              label="Total budget"
              value={formatEtb(campaign.budget)}
            />
            <LedgerRow
              label={
                campaign.status === 'draft' ? 'Running total' : 'Committed'
              }
              value={formatEtb(committed)}
            />
            {escrowed > 0 ? (
              <LedgerRow
                label={HELD_IN_ESCROW_LABEL}
                value={formatEtb(escrowed)}
                note={HELD_IN_ESCROW_NOTE}
              />
            ) : null}
            {performance.settlement.paidOut > 0 ? (
              <>
                <LedgerRow
                  label={PAID_OUT_LABEL}
                  value={formatEtb(performance.settlement.paidOut)}
                />
                <LedgerRow
                  label={COMMISSION_LABEL}
                  value={formatEtb(performance.settlement.commission)}
                  note={SETTLEMENT_NOTE}
                />
              </>
            ) : null}
            {performance.settlement.refunded > 0 ? (
              <LedgerRow
                label={REFUNDED_LABEL}
                value={formatEtb(performance.settlement.refunded)}
                note={REFUNDED_NOTE}
              />
            ) : null}
          </div>

          {campaign.status === 'confirmed' ? (
            <div className="bd-railcell">
              {!chapaMode ? (
                <FundCampaignButton
                  campaignId={campaign.id}
                  acceptedCount={acceptedCount}
                  size="lg"
                />
              ) : openSession ? (
                <PendingPaymentBanner
                  campaignId={campaign.id}
                  checkoutUrl={openSession.checkoutUrl}
                />
              ) : (
                <FundCheckoutButton
                  campaignId={campaign.id}
                  acceptedCount={acceptedCount}
                  formattedTotal={formatEtb(committed)}
                  testMode={uxMode === 'chapa-test'}
                  size="lg"
                />
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </BdShell>
  );
}
