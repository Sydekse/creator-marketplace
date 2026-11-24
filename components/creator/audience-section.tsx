import { SectionLabel } from '@/components/layout/section-label';
import type { CreatorAudience } from '@/lib/creators/detail';
import { NOT_PROVIDED } from '@/lib/creators/profile-facts';

/**
 * The audience breakdown. Every value here is already a display string —
 * `readAudience` resolved the market codes and kept anything it did not
 * recognise verbatim, so nothing below can render `undefined`.
 *
 * An empty breakdown answers with `NOT_PROVIDED`, the same constant the two
 * optional metrics use. A creator who never filled this in has not told a brand
 * their audience is nobody, and one screen saying "None" while another says
 * "Not provided" about the same kind of gap is how that distinction erodes.
 *
 * On the dashboard this sits in the wide column of the bottom row (1.45fr) —
 * so the label rides the left edge and the two facts spread across the card,
 * each in its own lane, instead of clustering in one corner.
 *
 * Shared between the brand-facing creator detail page and the creator's own
 * dashboard (§11), so both see the same rendering for the same data.
 */
export function AudienceSection({
  audience,
  title = 'Your audience',
}: {
  audience: CreatorAudience;
  /** Brand-facing pages pass "Audience"; creators keep the original voice. */
  title?: string;
}) {
  const { markets, ageRange } = audience;

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel>{title}</SectionLabel>
      {/* Nested inside the profile card on the dashboard — compact lanes,
          not display figures. */}
      <dl className="grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div className="flex flex-col gap-1">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
            Top markets
          </dt>
          <dd className="text-sm font-medium text-neutral-900">
            {markets.length > 0 ? markets.join(', ') : NOT_PROVIDED}
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:border-l sm:border-neutral-200 sm:pl-6">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
            Age range
          </dt>
          <dd className="text-sm font-medium tabular-nums text-neutral-900">
            {ageRange ?? NOT_PROVIDED}
          </dd>
        </div>
      </dl>
    </div>
  );
}
