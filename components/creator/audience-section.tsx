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
    <div className="flex flex-col gap-5">
      <SectionLabel>{title}</SectionLabel>
      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Top markets</dt>
          <dd className="mt-1 text-sm font-medium text-neutral-900">
            {markets.length > 0 ? markets.join(', ') : NOT_PROVIDED}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Age range</dt>
          <dd className="mt-1 text-sm font-medium text-neutral-900">
            {ageRange ?? NOT_PROVIDED}
          </dd>
        </div>
      </dl>
    </div>
  );
}
