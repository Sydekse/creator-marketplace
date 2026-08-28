import type { CreatorStatus } from '@/db/schema';

import { Chip, type ChipTone } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { cn } from '@/lib/utils';

/**
 * What a creator sees about their own verification (US-001's "awaiting
 * verification" state, and the two states KAN-22 can move them to).
 *
 * Verification is genuinely manual for the MVP — an admin looks at the handle
 * and decides. The copy says so rather than implying a system is processing
 * something, because a creator who thinks it is automatic will refresh for an
 * hour and then email support.
 */

const STATUS_TONE: Record<CreatorStatus, ChipTone> = {
  pending_verification: 'amber',
  verified: 'success',
  rejected: 'red',
};

const STATUS_LABEL: Record<CreatorStatus, string> = {
  pending_verification: 'Awaiting verification',
  verified: 'Verified',
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

/**
 * The three steps a creator moves through.
 *
 * Numbered because this genuinely is a sequence with a fixed order — tier and
 * price cannot be assigned before a person has confirmed the handle is real.
 * `current` shades the steps that have not happened yet, so the list doubles as
 * a position indicator without a progress bar pretending to measure time.
 */
const STEPS = [
  {
    title: 'Profile submitted',
    detail: 'Your handle and audience details are in.',
  },
  {
    title: 'A person checks your handle',
    detail: 'We confirm the TikTok account is yours and active.',
  },
  {
    title: 'Tier and price assigned',
    detail: 'Once assigned, brands can find you and send offers.',
  },
] as const;

function StepList({ reachedStep }: { reachedStep: number }) {
  return (
    <ol className="flex flex-col gap-4">
      {STEPS.map((step, index) => {
        const done = index < reachedStep;
        return (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs',
                done
                  ? 'bg-foreground text-background'
                  : 'border border-border text-muted-foreground'
              )}
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-0.5">
              <p
                className={cn(
                  'text-sm font-medium',
                  !done && 'text-muted-foreground'
                )}
              >
                {step.title}
              </p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function VerificationStatus({
  status,
  tiktokHandle,
  hasTier,
  name,
}: {
  status: CreatorStatus;
  tiktokHandle: string;
  /**
   * Verified is not the last step — a creator is only bookable once they also
   * have a tier (AC-006), and tier assignment is a separate admin action
   * (KAN-23). Passing it in keeps this component honest about the difference
   * between "approved" and "brands can see me".
   */
  hasTier: boolean;
  /** Sign-up name, shown in the greeting above the handle. */
  name: string;
}) {
  const reachedStep = status === 'verified' ? (hasTier ? 3 : 2) : 1;

  /**
   * Verified *and* tiered — nothing about verification is outstanding (KAN-200).
   *
   * The stepper is an onboarding artefact. Three ticked steps at the top of a
   * dashboard a creator opens every day is the single biggest reason the page
   * read as a form rather than a place of work: the first screenful was entirely
   * about a process that finished. The handle and the chip stay, because "am I
   * still verified" is a real question; "what happens next" is not, once the
   * answer is nothing.
   *
   * Deliberately the same predicate as `isBookable` (AC-006), not just
   * `status === 'verified'` — a verified creator with no tier still has a step
   * ahead of them, and it is the one they cannot do anything about, so it is the
   * one most worth showing.
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
        <p className="text-[11px] font-bold tracking-[0.12em] text-brand uppercase sm:text-[13px] sm:tracking-[0.14em]">
          Welcome back
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5 sm:gap-x-4 sm:gap-y-1">
          <div className="avatar-stack-circle row-span-2">
            <InitialsAvatar
              name={name}
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
          <div className="flex flex-col gap-6">
            <StepList reachedStep={reachedStep} />
            {status === 'verified' && !hasTier && (
              <p className="text-sm text-muted-foreground">
                You are verified. Brands can send you offers as soon as your
                tier is assigned.
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}
