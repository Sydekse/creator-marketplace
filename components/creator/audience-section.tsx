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
export function AudienceSection({ audience }: { audience: CreatorAudience }) {
  const { markets, ageRange } = audience;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
        Audience
      </h2>
      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Top markets</dt>
          <dd className="text-sm">
            {markets.length > 0 ? markets.join(', ') : NOT_PROVIDED}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Age range</dt>
          <dd className="text-sm">{ageRange ?? NOT_PROVIDED}</dd>
        </div>
      </dl>
    </section>
  );
}
