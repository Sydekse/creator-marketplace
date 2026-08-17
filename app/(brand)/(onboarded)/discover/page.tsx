import Link from 'next/link';
import { CreatorCard } from '@/components/creator/creator-card';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import {
  AUDIENCE_MARKET_CODES,
  AUDIENCE_MARKET_LABELS,
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

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Creator discovery (KAN-28, US-004, AC-010, AC-011; cards KAN-29, AC-012).
 *
 * Lives inside `(onboarded)` because the layout there redirects a brand with no
 * profile to onboarding — and that layout's own docstring names this route as
 * belonging to it. Route groups add nothing to the URL, so this answers
 * `/discover` and lights up the nav link `lib/navigation.ts` has been shipping
 * since KAN-18.
 *
 * Filters live in the URL rather than in component state, exactly as `?page=`
 * does on the admin verification queue. That is what re-runs the query on a
 * Server Component, and it makes a filtered view shareable and bookmarkable —
 * a brand can send a colleague the exact shortlist they are looking at.
 *
 * The form is therefore a plain `<form method="GET">` over native `<select>`
 * and no client JavaScript at all: the URL is the state, and a GET form is how
 * a browser writes to it. shadcn's `Select` is Base UI and a client component,
 * and it renders no `<input>`, so it would need a hidden field to submit a
 * value — a client bundle bought for nothing.
 *
 * What a result shows is `CreatorCard`'s business, not this page's. This one
 * owns the URL, the filter form and the pager; the card owns AC-012's four facts
 * and the link into the detail view. Both stay server-rendered, so the whole
 * screen still ships no client JavaScript.
 *
 * The bookable rule appears nowhere below. `readDiscovery` owns it, seeded into
 * the query before any filter here is read (AC-006).
 */

/** Rendered when the URL's filters cannot be parsed — see the note below. */
function UnreadableFilters() {
  return (
    <EmptyState
      title="Those filters could not be read."
      description="The link may be mistyped or out of date. Clear the filters and try again."
      action={
        <Link
          href="/discover"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Clear filters
        </Link>
      }
    />
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
      <div className="mx-auto flex max-w-4xl flex-col gap-8 py-4">
        <Header />
        <UnreadableFilters />
      </div>
    );
  }

  const filters = parsed.data;
  const [{ creators, hasMore }, tiers] = await Promise.all([
    readDiscovery({
      ...filters,
      limit: PAGE_SIZE,
      offset: offsetForPage(page),
    }),
    readTierPriceOptions(),
  ]);

  // Carried onto the pager links so paging keeps the filters — otherwise page 2
  // silently widens the search back to everything.
  const filterQuery = search.toString();
  const pageHref = (n: number) =>
    `/discover?${filterQuery ? `${filterQuery}&` : ''}page=${n}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-4">
      <Header />

      <form
        method="GET"
        action="/discover"
        className="flex flex-col gap-4 rounded-lg border border-border p-4"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Niche</span>
            <select
              name="niche"
              defaultValue={filters.niche ?? ''}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Any niche</option>
              {NICHES.map((niche) => (
                <option key={niche} value={niche}>
                  {NICHE_LABELS[niche]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Audience market</span>
            <select
              name="audience"
              defaultValue={filters.audience ?? ''}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Any market</option>
              {AUDIENCE_MARKET_CODES.map((code) => (
                <option key={code} value={code}>
                  {AUDIENCE_MARKET_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          {/* Price is a pair of selects over real tier prices rather than two
              number boxes. Prices are integer santim (invariant 4) and a brand
              thinks in birr; an option can carry the first as its value and the
              second as its label, where a text box would have to be one or the
              other. See `readTierPriceOptions`. */}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Min price per video</span>
            <select
              name="price_min"
              defaultValue={
                filters.priceMin === undefined ? '' : String(filters.priceMin)
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">No minimum</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.pricePerVideo}>
                  {formatEtb(tier.pricePerVideo)} ({tier.name})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Max price per video</span>
            <select
              name="price_max"
              defaultValue={
                filters.priceMax === undefined ? '' : String(filters.priceMax)
              }
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">No maximum</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.pricePerVideo}>
                  {formatEtb(tier.pricePerVideo)} ({tier.name})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Minimum engagement</span>
            <input
              type="number"
              name="min_engagement"
              min={0}
              max={100}
              step={0.1}
              inputMode="decimal"
              placeholder="Any"
              defaultValue={filters.minEngagement ?? ''}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            Apply filters
          </button>
          {/* A link, not a reset button: clearing means navigating to the
              unfiltered URL, and `type="reset"` would only restore the inputs
              while leaving the query string — and the results — untouched. */}
          <Link
            href="/discover"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Clear
          </Link>
        </div>
      </form>

      {creators.length === 0 ? (
        // AC-011's exact string, in two halves from one constant so the two
        // cannot be paraphrased apart.
        <EmptyState
          title={NO_MATCHES_TITLE}
          description={NO_MATCHES_DESCRIPTION}
        />
      ) : (
        // One column on a phone, two from `sm:` up (NFR-007). A list, not a bare
        // grid of divs: these are results, and a screen reader announcing "list,
        // 12 items" is how a brand hears the size of what they filtered to.
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {creators.map((creator) => (
            <li key={creator.id}>
              <CreatorCard creator={creator} />
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {creators.length > 0
              ? `Showing ${offsetForPage(page) + 1}–${offsetForPage(page) + creators.length}`
              : `Nothing on page ${page}`}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            {hasMore && (
              <Link
                href={pageHref(page + 1)}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="Discover creators"
      description="Verified creators with a published rate. Filters combine — each one narrows the list further."
    />
  );
}
