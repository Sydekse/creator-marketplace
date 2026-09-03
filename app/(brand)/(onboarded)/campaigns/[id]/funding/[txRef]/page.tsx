import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
  Receipt,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { getFundingSessionForBrand } from '@/lib/campaigns/fund-session';
import { settleFundingSession } from '@/lib/campaigns/settle-funding';
import { HELD_IN_ESCROW_NOTE } from '@/lib/campaigns/constants';
import { formatEtb } from '@/lib/money';
import { getPaymentGateway } from '@/lib/payment/gateway';
import { UUID_REGEX } from '@/lib/validation';
import { cn } from '@/lib/utils';

// Every render may verify against Chapa and move money — never cache it.
export const dynamic = 'force-dynamic';

/**
 * The Chapa return page (KAN-70): where the brand lands after checkout, and
 * the funding receipt once the money is confirmed.
 *
 * The load-bearing detail: rendering this page **settles the session** when
 * it is still open — verify against Chapa's API, hold escrow, consume. That
 * makes the flow correct with zero webhook configuration (previews of
 * feature branches never receive webhooks; the dashboard URL points at one
 * deployment), and merely makes it faster when the webhook already won the
 * race, in which case the session reads `consumed` and settling no-ops.
 *
 * A refresh is therefore always safe — settlement is idempotent — which is
 * why the pending state can offer one as its primary action.
 */
export default async function FundingReturnPage({
  params,
}: {
  params: Promise<{ id: string; txRef: string }>;
}) {
  const { id, txRef } = await params;
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  if (!UUID_REGEX.test(id) || !/^cmfund_[0-9a-f-]{36}$/.test(txRef)) {
    notFound();
  }

  const session = await getFundingSessionForBrand(txRef, id, profile.id);
  if (!session) notFound();

  let status = session.status;
  if (
    (status === 'initialized' ||
      status === 'expired' ||
      status === 'verified') &&
    getPaymentGateway()
  ) {
    const settled = await settleFundingSession(txRef);
    status =
      settled.outcome === 'consumed' || settled.outcome === 'already_consumed'
        ? 'consumed'
        : settled.outcome === 'failed'
          ? 'failed'
          : 'initialized'; // pending — charge not confirmed yet
  }

  const paidDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <BdShell>
      <div
        className="bd-fundwrap bd-rise"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        {status === 'consumed' ? (
          <section className="bd-fundcard print:border-0 print:shadow-none">
            <div className="bd-fundhead">
              <CheckCircle
                size={48}
                weight="fill"
                aria-hidden
                className="bd-fundicon--ok"
              />
              <h1>Payment received</h1>
              <p>Your campaign is funded. {HELD_IN_ESCROW_NOTE}</p>
            </div>

            <dl className="bd-fundrows">
              <ReceiptRow label="Campaign" value={session.campaignName} />
              <ReceiptRow
                label="Amount paid"
                value={formatEtb(session.amount)}
                strong
              />
              <ReceiptRow label="Date" value={paidDate} />
              <ReceiptRow label="Reference" value={txRef} mono />
              {session.providerRef ? (
                <ReceiptRow
                  label="Chapa reference"
                  value={session.providerRef}
                  mono
                />
              ) : null}
            </dl>

            <div className="bd-fundacts print:hidden">
              <Link
                href={`/campaigns/${id}`}
                className="bd-btn bd-btn--primary"
              >
                <ArrowLeft size={14} weight="regular" aria-hidden />
                Back to campaign
              </Link>
              <PrintHint />
            </div>
          </section>
        ) : status === 'failed' ? (
          <section className="bd-fundcard">
            <div className="bd-fundhead">
              <XCircle
                size={48}
                weight="fill"
                aria-hidden
                className="bd-fundicon--bad"
              />
              <h1>Payment not completed</h1>
              <p>
                This payment didn&apos;t go through, and nothing was charged to
                your campaign. You can start a new payment from the campaign
                page.
              </p>
            </div>
            <div className="bd-fundacts">
              <Link
                href={`/campaigns/${id}`}
                className="bd-btn bd-btn--primary"
              >
                <ArrowLeft size={14} weight="regular" aria-hidden />
                Back to campaign
              </Link>
            </div>
          </section>
        ) : (
          <section className="bd-fundcard">
            <div className="bd-fundhead">
              <ArrowsClockwise
                size={48}
                weight="regular"
                aria-hidden
                className="bd-fundicon--wait animate-spin [animation-duration:2.5s]"
              />
              <h1>Confirming your payment…</h1>
              <p>
                We&apos;re waiting for Chapa to confirm the charge. This usually
                takes a few seconds — refresh to check again, or resume the
                checkout if you haven&apos;t paid yet.
              </p>
            </div>
            <div className="bd-fundacts">
              <Link
                href={`/campaigns/${id}/funding/${txRef}`}
                className="bd-btn bd-btn--primary"
              >
                <ArrowsClockwise size={14} weight="regular" aria-hidden />
                Refresh
              </Link>
              <a href={session.checkoutUrl} className="bd-btn bd-btn--ghost">
                Resume checkout
              </a>
              <Link href={`/campaigns/${id}`} className="bd-btn bd-btn--ghost">
                <ArrowLeft size={14} weight="regular" aria-hidden />
                Back to campaign
              </Link>
            </div>
          </section>
        )}
      </div>
    </BdShell>
  );
}

function ReceiptRow({
  label,
  value,
  strong = false,
  mono = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="bd-fundrow">
      <dt>{label}</dt>
      <dd
        className={cn(
          (strong || mono) && 'bd-mono',
          strong && 'bd-fundrow--strong',
          mono && 'bd-fundrow--mono'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function PrintHint() {
  return (
    <p className="bd-fundprint">
      <Receipt size={14} weight="regular" aria-hidden />
      Print this page for your records
    </p>
  );
}
