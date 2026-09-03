import { Suspense } from 'react';
import Link from 'next/link';
import { JetBrains_Mono, Outfit } from 'next/font/google';
import { FilterCount } from '@/components/discovery/filter-count';
import { DiscoverFilterForm } from '@/components/discovery/filter-form';
import { FilterSelect } from '@/components/discovery/filter-select';
import { PriceRange } from '@/components/discovery/price-range';
import { SelectableCreatorGrid } from '@/components/discovery/selectable-creator-grid';
import { WorkspaceLoading } from '@/components/layout/workspace-loading';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';
import {
  AUDIENCE_MARKET_CODES,
  AUDIENCE_MARKET_LABELS,
  ENGAGEMENT_RATE_HINT,
  NICHES,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import {
  DISCOVERY_PARAM_ALIASES,
  NO_MATCHES_DESCRIPTION,
  NO_MATCHES_TITLE,
  readDiscovery,
  readTierPriceOptions,
} from '@/lib/creators/discovery';
import { formatEtb } from '@/lib/money';
import { PAGE_SIZE, offsetForPage, pageFromParam } from '@/lib/paging';
import { readParams, searchParamsFrom } from '@/lib/query-params';
import { discoverCreatorsSchema } from '@/lib/validation';
import { cn } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Creator discovery (KAN-28, US-004, AC-010, AC-011; cards KAN-29, AC-012) —
 * the v4 visual language shared with the brand dashboard and campaigns pages:
 * ruled masthead, sticky filter rail in the rail-card grammar, and the results
 * grid as the working surface.
 *
 * Lives inside `(onboarded)` because the layout there redirects a brand with no
 * profile to onboarding — and that layout's own docstring names this route as
 * belonging to it. Route groups add nothing to the URL, so this answers
 * `/discover` and lights up the nav link `lib/navigation.ts` has been shipping
 * since KAN-18.
 *
 * Filters live in the URL rather than in component state, exactly as `?page=`
 * does on the admin tiers page. That is what re-runs the query on a
 * Server Component, and it makes a filtered view shareable and bookmarkable —
 * a brand can send a colleague the exact shortlist they are looking at.
 *
 * The form is therefore a plain `<form method="GET">` and no client JavaScript
 * at all: the URL is the state, and a GET form is how a browser writes to it.
 *
 * Loading is column-scoped: every data read lives in the async `Results` (and
 * the rail's tier options in `FilterRail`), each behind its own Suspense
 * boundary. `Results` is keyed on the query so a search swaps in a centered
 * pending state exactly where the cards are, while the masthead and the rail
 * the brand is holding stay put — the route-level loading screen never runs
 * for a filter change.
 *
 * What a result shows is `CreatorCard`'s business, not this page's. This one
 * owns the URL, the filter form and the pager; the card owns AC-012's four
 * facts. The results grid is the one client island: `SelectableCreatorGrid`
 * turns tiles into mark-and-add toggles (click marks, "See details" opens the
 * profile) with a batch bar posting to `/items/bulk`. Selection deliberately
 * does not live in the URL — it is a shopping gesture, not a shareable view.
 *
 * The bookable rule appears nowhere below. `readDiscovery` owns it, seeded into
 * the query before any filter here is read (AC-006).
 */

const bdSans = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bd-sans',
});
const bdMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-bd-mono',
});

type DiscoverFilters = ReturnType<typeof discoverCreatorsSchema.parse>;

/** Whole-birr option label — tier prices are round figures, so the `.00`
 *  tail is noise in a select; santim appear only when actually nonzero. */
function etbOptionLabel(santim: number): string {
  return santim % 100 === 0
    ? `${Math.trunc(santim / 100).toLocaleString('en-US')} ETB`
    : formatEtb(santim);
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('bd', bdSans.variable, bdMono.variable)}>{children}</div>
  );
}

function Masthead() {
  return (
    <header
      className="bd-pagehead bd-pagehead--ruled bd-rise"
      style={{ '--i': 0 } as React.CSSProperties}
    >
      <div>
        <p className="bd-eyebrow">Brand workspace</p>
        <h1 className="bd-h1">Discover creators</h1>
        <p className="bd-idfacts">
          Browse verified creators with published rates. Each filter narrows the
          results.
        </p>
      </div>
      <div className="bd-headact">
        <div className="bd-dischint">
          <span className="bd-dischintmark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.2 4.3L19 7.2" />
            </svg>
          </span>
          <span className="bd-dischinttext">
            <b>Mark cards to shortlist</b>
            <span>then add them to a campaign</span>
          </span>
        </div>
      </div>
    </header>
  );
}

/** Rendered when the URL's filters cannot be parsed — see the note below. */
function UnreadableFilters() {
  return (
    <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
      <div className="bd-emptyfeed">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M15.8 15.8 20 20" />
        </svg>
        <h3>Those filters could not be read.</h3>
        <p>
          The link may be mistyped or out of date. Clear the filters and try
          again.
        </p>
        <Link className="bd-btn bd-btn--ghost" href="/discover">
          Clear filters
        </Link>
      </div>
    </div>
  );
}

/** The search pending state: the app's mark loader, seated low in the
 *  container that holds the cards while the masthead and rail stay put. */
function ResultsPending() {
  return (
    <div className="bd-discresults bd-discpending">
      <WorkspaceLoading />
    </div>
  );
}

/** First-paint stand-in for the rail while tier options load: the same
 *  card silhouette with shimmering label/field bars, so the "Refine
 *  shortlist" column holds its shape instead of arriving as a void. */
function RailPending() {
  return (
    <div className="bd-caprail bd-discrail bd-discrailghost" aria-hidden="true">
      <div className="bd-railcell bd-discskelcell">
        <span className="bd-skel bd-discskel--head" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bd-railcell bd-discskelcell">
          <span className="bd-skel bd-discskel--label" />
          <span className="bd-skel bd-discskel--field" />
        </div>
      ))}
      <div className="bd-railcell bd-discskelcell">
        <span className="bd-skel bd-discskel--btn" />
      </div>
    </div>
  );
}

/**
 * The filter rail. Async because the price selects list real tier prices —
 * inside its own unkeyed Suspense boundary so a search keeps the rail the
 * brand is holding instead of flashing a fallback.
 */
async function FilterRail({
  filters,
  activeFilterCount,
}: {
  filters: DiscoverFilters;
  activeFilterCount: number;
}) {
  const tiers = await readTierPriceOptions();
  return (
    <DiscoverFilterForm className="bd-caprail bd-discrail">
      <div className="bd-railcell">
        <span className="bd-railk bd-discfilterk">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5h16l-6.2 7.2v5.4l-3.6-1.8v-3.6L4 5.5Z" />
          </svg>
          Refine shortlist
          {/* Counts the form's live values on the client — the chip moves the
              moment a field changes, not when the search lands. */}
          <FilterCount initial={activeFilterCount} />
        </span>
        <span className="bd-railn">
          Narrow by audience, rate, and engagement.
        </span>
      </div>

      <div className="bd-railcell bd-discfields">
        {/* Who: niche and market share a row — both are one-word answers. */}
        <div className="bd-discrow">
          <label className="bd-discfield">
            <span className="bd-disclab">Niche</span>
            <FilterSelect
              name="niche"
              value={filters.niche}
              placeholder="Any"
              options={NICHES.map((niche) => ({
                value: niche,
                label: NICHE_LABELS[niche],
              }))}
            />
          </label>

          <label className="bd-discfield">
            <span className="bd-disclab">Audience</span>
            <FilterSelect
              name="audience"
              value={filters.audience}
              placeholder="Any"
              options={AUDIENCE_MARKET_CODES.map((code) => ({
                value: code,
                label: AUDIENCE_MARKET_LABELS[code],
              }))}
            />
          </label>
        </div>

        {/* Price is one range, not two questions: min and max joined under a
          single label, coordinated so an inverted range cannot be picked.
          The selects list real tier prices rather than free number boxes —
          prices are integer santim (invariant 4) and a brand thinks in birr;
          an option carries the first as its value and the second as its
          label. See `readTierPriceOptions`. */}
        <div
          className="bd-discfield"
          role="group"
          aria-label="Price per video in birr"
        >
          <span className="bd-disclab">Price per video (ETB)</span>
          <PriceRange
            min={
              filters.priceMin === undefined
                ? undefined
                : String(filters.priceMin)
            }
            max={
              filters.priceMax === undefined
                ? undefined
                : String(filters.priceMax)
            }
            options={tiers.map((tier) => ({
              value: String(tier.pricePerVideo),
              label: `${etbOptionLabel(tier.pricePerVideo)} (${tier.name})`,
            }))}
          />
        </div>

        <label className="bd-discfield">
          <span className="bd-disclab">Minimum engagement</span>
          <input
            type="number"
            name="min_engagement"
            min={0}
            max={100}
            step={0.1}
            inputMode="decimal"
            placeholder="Any"
            defaultValue={filters.minEngagement ?? ''}
            className="bd-discinput"
          />
          {/* The same sentence the creator saw when they entered the figure
            (KAN-200). Filtering on a number nobody has defined is guessing,
            and a filter that explained it differently from the field it
            filters on would be worse than neither explaining it. */}
          <span className="bd-railn">{ENGAGEMENT_RATE_HINT}</span>
        </label>
      </div>

      <div className="bd-railcell bd-discactions">
        <button type="submit" className="bd-btn bd-btn--primary">
          Apply filters
        </button>
        {/* A link, not a reset button: clearing means navigating to the
          unfiltered URL, and `type="reset"` would only restore the inputs
          while leaving the query string — and the results — untouched. */}
        <Link href="/discover" className="bd-btn bd-btn--ghost">
          Clear
        </Link>
      </div>
    </DiscoverFilterForm>
  );
}

/** The results column — every per-search read lives here, behind Suspense. */
async function Results({
  filters,
  page,
  filterQuery,
}: {
  filters: DiscoverFilters;
  page: number;
  filterQuery: string;
}) {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  const [{ creators, hasMore }, draftCampaigns] = await Promise.all([
    readDiscovery({
      ...filters,
      limit: PAGE_SIZE,
      offset: offsetForPage(page),
    }),
    // The mark-and-add bar's "add to" picker. Empty when the brand has no
    // drafts — the bar says so rather than offering a dead select.
    profile ? listDraftCampaignsByBrand(profile.id) : Promise.resolve([]),
  ]);

  // Carried onto the pager links so paging keeps the filters — otherwise page 2
  // silently widens the search back to everything.
  const pageHref = (n: number) =>
    `/discover?${filterQuery ? `${filterQuery}&` : ''}page=${n}`;

  return (
    <div className="bd-discresults">
      <p className="bd-discresultline">
        <b>{creators.length}</b>{' '}
        {creators.length === 1 ? 'creator matches' : 'creators match'} your
        current shortlist
      </p>

      {creators.length === 0 ? (
        // AC-011's exact string, in two halves from one constant so the two
        // cannot be paraphrased apart.
        <div className="bd-emptyfeed">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M15.8 15.8 20 20" />
          </svg>
          <h3>{NO_MATCHES_TITLE}</h3>
          <p>{NO_MATCHES_DESCRIPTION}</p>
        </div>
      ) : (
        // One column on a phone, two from `sm:` up (NFR-007). A list, not a
        // bare grid of divs: these are results, and a screen reader
        // announcing "list, 12 items" is how a brand hears the size of what
        // they filtered to.
        //
        // The tiles mark rather than navigate — the grid is a client island
        // owning selection, with "See details" as the explicit way into a
        // profile. The detail route still answers `/discover/[id]` directly.
        <SelectableCreatorGrid
          creators={creators}
          draftCampaigns={draftCampaigns.map((c) => ({
            id: c.id,
            name: c.name,
          }))}
        />
      )}

      {(page > 1 || hasMore) && (
        <div className="bd-discpager">
          <p className="bd-mono">
            {creators.length > 0
              ? `Showing ${offsetForPage(page) + 1}–${offsetForPage(page) + creators.length}`
              : `Nothing on page ${page}`}
          </p>
          <div>
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="bd-btn bd-btn--ghost">
                Previous
              </Link>
            )}
            {hasMore && (
              <Link href={pageHref(page + 1)} className="bd-btn bd-btn--ghost">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const search = searchParamsFrom(await searchParams);

  // Paging is not filtering, so `page` is taken out before the filter schema
  // sees the query string — `.strict()` would otherwise reject it as unknown.
  const page = pageFromParam(search.get('page') ?? undefined);
  search.delete('page');

  const { params, conflicts } = readParams(search, DISCOVERY_PARAM_ALIASES);
  const parsed = discoverCreatorsSchema.safeParse(params);

  // A page cannot answer 422, but it must not answer a *mistyped* filter with
  // the full catalogue either — that is the failure `.strict()` exists to
  // prevent, and rendering every creator would look like a successful search.
  // Saying the filters were unreadable is the honest version of the same 422.
  if (conflicts.length > 0 || !parsed.success) {
    return (
      <PageShell>
        <Masthead />
        <UnreadableFilters />
      </PageShell>
    );
  }

  const filters = parsed.data;
  // The rail header's first-paint count; the client keeps it live from there.
  const activeFilterCount = [
    filters.niche,
    filters.audience,
    filters.priceMin,
    filters.priceMax,
    filters.minEngagement,
  ].filter((v) => v !== undefined).length;
  const filterQuery = search.toString();

  return (
    <PageShell>
      <Masthead />

      <div
        className="bd-discsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <Suspense fallback={<RailPending />}>
          <FilterRail filters={filters} activeFilterCount={activeFilterCount} />
        </Suspense>

        <Suspense key={`${filterQuery}|${page}`} fallback={<ResultsPending />}>
          <Results filters={filters} page={page} filterQuery={filterQuery} />
        </Suspense>
      </div>
    </PageShell>
  );
}
