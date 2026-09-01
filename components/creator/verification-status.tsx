import type { CreatorStatus } from '@/db/schema';

import { Chip, type ChipTone } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';

/**
 * What a creator sees about their own profile state.
 *
 * Verification is automatic since phase 2 (KAN-39): completing onboarding
 * lands the profile `verified`, and tier assignment runs in the same
 * transaction. There is no human review step, so there is no stepper and no
 * "awaiting verification" journey — the only unsettled state left is
 * "verified but no tier matched", which is about the creator's numbers, not
 * about a process they are waiting on.
 *
 * `pending_verification` and `rejected` remain valid column values (rows from
 * before the migration, and the enum itself) so the chip still renders them
 * honestly rather than crashing on history.
 */

const STATUS_TONE: Record<CreatorStatus, ChipTone> = {
  pending_verification: 'amber',
  verified: 'success',
  rejected: 'red',
};

const STATUS_LABEL: Record<CreatorStatus, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Live',
  rejected: 'Not approved',
};

export function StatusChip({
  status,
  className,
}: {
  status: CreatorStatus;
  className?: string;
}) {
  return (
    <Chip tone={STATUS_TONE[status]} size="md" className={className}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

export function VerificationStatus({
  status,
  tiktokHandle,
  hasTier,
  name,
  image,
}: {
  status: CreatorStatus;
  tiktokHandle: string;
  /**
   * Live is not the last step — a creator is only bookable once they also
   * have a tier (AC-006). Passing it in keeps this component honest about the
   * difference between "profile exists" and "brands can see me".
   */
  hasTier: boolean;
  /** Sign-up name, shown in the greeting above the handle. */
  name: string;
  /** Profile picture; initials fallback when null. */
  image?: string | null;
}) {
  /**
   * Verified *and* tiered — nothing is outstanding (KAN-200). Deliberately the
   * same predicate as `isBookable` (AC-006), not just `status === 'verified'`:
   * a live creator with no tier still has something ahead of them, and it is
   * the thing most worth explaining.
   */
  const settled = status === 'verified' && hasTier;

  return (
    <div className="flex flex-col gap-8">
      {/* The creator dashboard's page opener, and it lives here because the
          handle and the status chip are one statement — "this account, in this
          state" — and splitting them would let a later edit move one without the
          other (KAN-200).

          `PageHeader` rather than the bespoke stack this used to be: every other
          page in the app opens with the teal label, the serif `h1` and the
          hairline (design doc §10.5), and `/creator` opening differently was part
          of why it did not read as a dashboard. The handle loses its mono
          treatment in the swap, which is the right way round — `discover/[id]`
          already renders the same handle as a serif page title, so the two
          screens now agree on what a handle looks like. Nothing on this page
          asks the creator to *type* it. */}
      <div className="flex flex-col gap-3 border-b border-neutral-200 pb-3 sm:gap-4 sm:pb-4">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-brand-ink uppercase sm:text-[13px] sm:tracking-[0.14em]">
          Welcome back
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 gap-y-1 sm:gap-x-4 sm:gap-y-1">
          <div className="avatar-stack-circle row-span-2">
            <InitialsAvatar
              name={name}
              image={image}
              className="!size-full rounded-full border-neutral-900 bg-neutral-900 text-neutral-50 shadow-none"
            />
          </div>
          <h1 className="page-title opener-title min-w-0">{name}</h1>
          <StatusChip status={status} />
          <p className="col-span-2 col-start-2 font-mono text-xs text-neutral-600 sm:text-sm">
            {tiktokHandle}
          </p>
        </div>
      </div>

      {status === 'rejected' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            We could not verify this account.
          </p>
          <p className="text-sm text-muted-foreground">
            This usually means the handle does not exist or does not match the
            details you gave us. Email support and we will take another look.
          </p>
        </div>
      ) : (
        !settled && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              Your profile is live, but not bookable yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Your follower count and engagement rate did not match a pricing
              tier, so brands cannot find you in search yet. Once your numbers
              grow — or an admin assigns a tier — offers can start arriving.
            </p>
          </div>
        )
      )}
    </div>
  );
}
