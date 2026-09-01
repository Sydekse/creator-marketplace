import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
  Receipt,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { buttonVariants } from '@/components/ui/button';
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
    <div className="mx-auto flex max-w-xl flex-col gap-8 py-10">
      {status === 'consumed' ? (
        <section className="flex flex-col gap-6 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle
              size={48}
              weight="fill"
              aria-hidden
              className="text-emerald-500"
            />
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Payment received
            </h1>
            <p className="max-w-[40ch] text-sm leading-relaxed text-neutral-600">
              Your campaign is funded. {HELD_IN_ESCROW_NOTE}
            </p>
          </div>

          <dl className="flex flex-col gap-3 border-t border-neutral-200 pt-6 text-sm">
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

          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-neutral-200 pt-6 print:hidden">
            <Link
              href={`/campaigns/${id}`}
              className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
            >
              <ArrowLeft size={14} weight="regular" aria-hidden />
              Back to campaign
            </Link>
            <PrintHint />
          </div>
        </section>
      ) : status === 'failed' ? (
        <section className="flex flex-col items-center gap-5 rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <XCircle
            size={48}
            weight="fill"
            aria-hidden
            className="text-red-500"
          />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Payment not completed
            </h1>
            <p className="max-w-[42ch] text-sm leading-relaxed text-neutral-600">
              This payment didn&apos;t go through, and nothing was charged to
              your campaign. You can start a new payment from the campaign page.
            </p>
          </div>
          <Link
            href={`/campaigns/${id}`}
            className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
          >
            <ArrowLeft size={14} weight="regular" aria-hidden />
            Back to campaign
          </Link>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-5 rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <ArrowsClockwise
            size={48}
            weight="regular"
            aria-hidden
            className="animate-spin text-brand [animation-duration:2.5s]"
          />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Confirming your payment…
            </h1>
            <p className="max-w-[42ch] text-sm leading-relaxed text-neutral-600">
              We&apos;re waiting for Chapa to confirm the charge. This usually
              takes a few seconds — refresh to check again, or resume the
              checkout if you haven&apos;t paid yet.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href={`/campaigns/${id}/funding/${txRef}`}
              className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
            >
              <ArrowsClockwise size={14} weight="regular" aria-hidden />
              Refresh
            </Link>
            <a
              href={session.checkoutUrl}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Resume checkout
            </a>
            <Link
              href={`/campaigns/${id}`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'gap-1.5'
              )}
            >
              <ArrowLeft size={14} weight="regular" aria-hidden />
              Back to campaign
            </Link>
          </div>
        </section>
      )}
    </div>
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
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={cn(
          'text-right break-all text-neutral-900',
          strong && 'font-mono text-base font-semibold tabular-nums',
          mono && 'font-mono text-xs'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function PrintHint() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-neutral-400">
      <Receipt size={14} weight="regular" aria-hidden />
      Print this page for your records
    </p>
  );
}
