import Link from 'next/link';
import { ChartBar, Info } from '@phosphor-icons/react/dist/ssr';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Chip } from '@/components/ui/chip';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/feedback/empty-state';
import {
  CohortNote,
  HistoryValues,
  Stat,
} from '@/components/campaign/insights';
import { InsightChart } from '@/components/campaign/insight-chart-lazy';
import { formatEtb } from '@/lib/money';
import { formatDeadlineUtc } from '@/lib/dates';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import {
  formatEfficiency,
  formatShare,
  INSIGHT_FIELDS,
  type CampaignInsightModel,
} from '@/lib/campaigns/insight-model';
import { stageRows } from '@/lib/campaigns/insight-display';
import {
  formatDuration,
  type CollaborationSummary,
} from '@/lib/campaigns/insight-history';
import { readBrandInsights } from '@/lib/brands/insights';
import { insightHref, type InsightFilters } from '@/lib/brands/insight-filters';
import {
  cohortShare,
  insightPage,
  INSIGHT_CHART_SIZE,
  recordedEngagement,
  sortedCampaigns,
  sortedCreators,
} from '@/lib/brands/insight-presentation';
import { InsightFiltersForm } from './filters';

type Report = Awaited<ReturnType<typeof readBrandInsights>>;
const count = (value: number | null) =>
  value === null ? 'Pending' : value.toLocaleString('en-US');
const linkClass =
  'rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-4';

function Pages({
  filters,
  field,
  page,
  pages,
  total,
}: {
  filters: InsightFilters;
  field: 'campaignPage' | 'creatorPage' | 'waitingPage';
  page: number;
  pages: number;
  total: number;
}) {
  const section =
    field === 'campaignPage'
      ? 'campaign-comparison'
      : field === 'creatorPage'
        ? 'creator-comparison'
        : 'waiting-work';
  return (
    <nav
      aria-label={`${field === 'campaignPage' ? 'Campaign' : field === 'creatorPage' ? 'Creator' : 'Waiting work'} pages`}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-xs text-muted-foreground">
        {total} records · Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={`${insightHref(filters, { [field]: page - 1 })}#${section}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Previous
          </Link>
        )}
        {page < pages && (
          <Link
            href={`${insightHref(filters, { [field]: page + 1 })}#${section}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

function MoneyAndResults({ model }: { model: CampaignInsightModel }) {
  const engagement = recordedEngagement(model);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Cost & recorded results</h2>
        </CardTitle>
        <CardDescription>
          All selected campaigns. Recorded totals cover a wider set of deals
          than the completed-deal efficiency comparisons.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-5 sm:grid-cols-3">
          <Stat
            label="Settled spend"
            value={formatEtb(model.settled)}
            note="Ledger payouts plus commission. Not all-in business costs."
          />
          <Stat
            label="Deal commitments"
            value={formatEtb(model.committed)}
            note="Issued deals that commit campaign budget, including completed work. Not additional spend to add to settled spend."
          />
          <Stat
            label="Refunded"
            value={formatEtb(model.refunded)}
            note="Returned to the brand, not recorded as settled spend."
          />
        </dl>
        <dl className="grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Recorded views"
            value={count(model.totals.views)}
            note={`${model.coverage.views} / ${model.orderedVideos} ordered videos measured`}
          />
          <Stat
            label="Recorded engagements"
            value={count(engagement.total)}
            note={`${engagement.videos} / ${model.orderedVideos} ordered videos have all of likes, comments and shares`}
          />
          <Stat
            label="Comparable CPV"
            value={formatEfficiency(model.cpv.ratio)}
            note="Eligible cost / recorded views. ETB per view."
          />
          <Stat
            label="Comparable CPE"
            value={formatEfficiency(model.cpe.ratio)}
            note="Eligible cost / recorded engagements. ETB per engagement."
          />
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold">CPV coverage</p>
            <CohortNote cohort={model.cpv} metric="cpv" />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">CPE coverage</p>
            <CohortNote cohort={model.cpe} metric="cpe" />
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium outline-offset-4">
            Measurement coverage & source
          </summary>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {INSIGHT_FIELDS.map((field) => (
              <div key={field}>
                <dt className="text-xs capitalize text-muted-foreground">
                  {field}
                </dt>
                <dd className="font-mono text-sm">
                  {count(model.totals[field])}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {model.coverage[field]} / {model.orderedVideos} ordered videos
                  measured
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {model.submittedVideos} current video records. Counts are
            creator/admin reported, not verified by TikTok. Unknown is not zero.
            A record update timestamp does not establish when every field was
            measured. See each campaign&apos;s video evidence for individual
            sources and update times.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function RevisionFeedback({ value }: { value: CollaborationSummary }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium outline-offset-4">
        Recorded revision feedback
      </summary>
      <p className="mt-3 text-xs text-muted-foreground">
        Reported reasons, not responsibility. Unknown reasons stay unknown.
      </p>
      <dl className="mt-3 flex flex-col gap-3">
        {value.revisionReasons.map((reason) => (
          <div
            key={reason.category}
            className="flex flex-wrap justify-between gap-2 text-xs"
          >
            <dt>{reason.label}</dt>
            <dd className="font-mono">
              {reason.count} · {reason.brand} brand / {reason.admin} admin /{' '}
              {reason.unknownActor} unknown
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Timing({ value }: { value: CollaborationSummary }) {
  const stages = stageRows(value);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Completed stage durations</h3>
      <p className="text-xs text-muted-foreground">
        Median elapsed time, not active effort or fault. Complete samples only;
        current waits and interrupted reviews are separate.
      </p>
      {stages.some((stage) => stage.primary !== null) && (
        <InsightChart
          rows={stages.map(({ id, label, primary }) => ({
            id,
            label,
            primary,
          }))}
          primaryLabel="Median hours"
          unit=" h"
        />
      )}
      <dl className="grid gap-4 sm:grid-cols-3">
        {stages.map((stage) => (
          <Stat
            key={stage.id}
            label={stage.label}
            value={formatDuration(stage.metric.medianMs)}
            note={`n=${stage.metric.n} · ${stage.metric.waiting.length} waiting intervals · ${stage.metric.interrupted.length} interrupted · ${stage.metric.excluded} unavailable intervals`}
          />
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Full delivery starts at funding; review starts when the complete deal is
        ready; replacement starts at the recorded rejection.
      </p>
    </div>
  );
}

function CampaignComparison({ report }: { report: Report }) {
  const { filters, overall } = report;
  const metric = filters.metric;
  const result = metric === 'cpv' ? 'views' : 'engagements';
  const selection = insightPage(
    sortedCampaigns(report.campaigns, filters.sort),
    filters.campaignPage
  );
  const chart = selection.rows.slice(0, INSIGHT_CHART_SIZE).map((row) => ({
    id: row.id,
    label: row.name,
    primary: (() => {
      const share = cohortShare(row.metrics[metric].cost, overall[metric].cost);
      return share === null ? null : share * 100;
    })(),
    secondary: (() => {
      const share = cohortShare(
        row.metrics[metric].results,
        overall[metric].results
      );
      return share === null ? null : share * 100;
    })(),
  }));
  return (
    <section
      id="campaign-comparison"
      aria-labelledby="campaign-comparison-title"
      className="scroll-mt-24"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="campaign-comparison-title">Campaign comparison</h2>
          </CardTitle>
          <CardDescription>
            Investment and observed contribution within the same completed,
            measured deals. Different objectives and video ages still limit
            comparisons.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <nav aria-label="Comparison measure" className="flex flex-wrap gap-2">
            {(['cpv', 'cpe'] as const).map((key) => (
              <Link
                key={key}
                href={`${insightHref(filters, { metric: key, creatorPage: 1 })}#campaign-comparison`}
                aria-current={key === metric ? 'page' : undefined}
                className={buttonVariants({
                  variant: key === metric ? 'default' : 'outline',
                  size: 'sm',
                })}
              >
                {key === 'cpv' ? 'Views' : 'Engagement'}
              </Link>
            ))}
          </nav>
          <CohortNote cohort={overall[metric]} metric={metric} />
          {overall[metric].deals > 0 ? (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-5 rounded-sm bg-brand-strong"
                  />
                  Eligible cost share
                </span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-5 rounded-sm bg-foreground"
                  />
                  Recorded {result} share
                </span>
              </div>
              <InsightChart
                rows={chart}
                primaryLabel="Cost share (%)"
                secondaryLabel={`${result} share (%)`}
                unit="%"
              />
              <p className="text-xs text-muted-foreground">
                Showing {chart.length} of {selection.total} campaigns, from this
                page&apos;s exact rows. Shares use all selected eligible deals,
                not just visible rows.
              </p>
            </>
          ) : (
            <EmptyState
              align="start"
              title="No comparable results yet"
              description="Completed deals need every ordered video measured before entering this comparison. Costs, recorded counts and delivery remain available below."
            />
          )}
          <ul
            className="flex flex-col gap-4"
            aria-label="Exact campaign comparisons"
          >
            {selection.rows.map((row) => {
              const m = row.metrics;
              const e = recordedEngagement(m);
              return (
                <li key={row.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/campaigns/${row.id}`}
                        className={`${linkClass} break-words`}
                      >
                        {row.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Created {formatDeadlineUtc(new Date(row.createdAt))}
                      </p>
                    </div>
                    <Chip tone={campaignStatusTone[row.status]}>
                      {campaignStatusLabel(row.status)}
                    </Chip>
                  </div>
                  {row.goal && (
                    <p className="mt-3 text-xs text-muted-foreground break-words">
                      Goal: {row.goal}
                    </p>
                  )}
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                      label="Settled / committed / refunded"
                      value={formatEtb(m.settled)}
                      note={`${formatEtb(m.committed)} committed · ${formatEtb(m.refunded)} refunded`}
                    />
                    <Stat
                      label="Recorded views / engagements"
                      value={count(m.totals.views)}
                      note={`${count(e.total)} engagements · views ${m.coverage.views}/${m.orderedVideos}, engagement ${e.videos}/${m.orderedVideos} measured`}
                    />
                    <Stat
                      label="Comparable CPV / CPE"
                      value={formatEfficiency(m.cpv.ratio)}
                      note={`CPE ${formatEfficiency(m.cpe.ratio)} · CPV n=${m.cpv.deals}, CPE n=${m.cpe.deals} eligible deals`}
                    />
                    <Stat
                      label="Completed / ever funded"
                      value={`${row.history.completion.completed} / ${row.history.completion.funded}`}
                      note={`${m.submittedVideos}/${m.orderedVideos} ordered videos submitted · ${row.history.punctuality.on_time}/${row.history.punctuality.eligible} initial deliveries without missed deadlines · ${row.history.punctuality.overdue} overdue`}
                    />
                  </dl>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Comparable {result}: {count(m[metric].results)} (
                    {formatShare(
                      cohortShare(m[metric].results, overall[metric].results)
                    )}{' '}
                    share) · eligible cost {formatEtb(m[metric].cost)} (
                    {formatShare(
                      cohortShare(m[metric].cost, overall[metric].cost)
                    )}{' '}
                    share).
                    {m.duplicateVideos > 0 &&
                      ` ${m.duplicateVideos} repeated video records; affected deals excluded across this selection.`}
                  </p>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium outline-offset-4">
                      Cohorts & delivery evidence
                    </summary>
                    <div className="mt-4 flex flex-col gap-5">
                      <CohortNote cohort={m.cpv} metric="cpv" />
                      <CohortNote cohort={m.cpe} metric="cpe" />
                      <HistoryValues value={row.history} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <Pages filters={filters} field="campaignPage" {...selection} />
        </CardContent>
      </Card>
    </section>
  );
}

function CreatorComparison({ report }: { report: Report }) {
  const { filters, overall } = report;
  const metric = filters.metric;
  const selection = insightPage(
    sortedCreators(overall.creators, metric),
    filters.creatorPage
  );
  const histories = new Map(
    report.history.creators.map((row) => [row.creatorId, row])
  );
  return (
    <section
      id="creator-comparison"
      aria-labelledby="creator-comparison-title"
      className="scroll-mt-24"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="creator-comparison-title">
              Creators across selected campaigns
            </h2>
          </CardTitle>
          <CardDescription>
            Your relationships, not a marketplace ranking. Ordered by available{' '}
            {metric.toUpperCase()}, then handle; unavailable values last. All
            history follows the campaign filters above.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {selection.total === 0 && (
            <EmptyState
              align="start"
              title="No creator collaborations yet"
              description="Creators appear here when offers are issued in these campaigns."
            />
          )}
          <ul
            className="flex flex-col gap-4"
            aria-label="Exact creator comparisons"
          >
            {selection.rows.map((creator) => {
              const history = histories.get(creator.id);
              const campaigns = report.campaigns.filter((row) =>
                row.metrics.creators.some((c) => c.id === creator.id)
              );
              return (
                <li key={creator.id} className="rounded-lg border p-4">
                  <h3 className="text-sm font-semibold break-words">
                    @{creator.handle}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {campaigns.length} selected campaigns ·{' '}
                    {creator.submittedVideos}/{creator.orderedVideos} videos
                    submitted
                  </p>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                      label="Recorded views"
                      value={count(creator.totals.views)}
                      note={`${creator.coverage.views}/${creator.orderedVideos} ordered videos measured`}
                    />
                    <Stat
                      label="Comparable CPV / CPE"
                      value={formatEfficiency(creator.cpv.ratio)}
                      note={`CPE ${formatEfficiency(creator.cpe.ratio)} · CPV n=${creator.cpv.deals}, CPE n=${creator.cpe.deals}`}
                    />
                    <Stat
                      label="Eligible cost / share"
                      value={formatEtb(creator[metric].cost)}
                      note={`${formatShare(metric === 'cpv' ? creator.viewCostShare : creator.engagementCostShare)} of the selected ${metric.toUpperCase()} cohort`}
                    />
                    <Stat
                      label={`Comparable ${metric === 'cpv' ? 'views' : 'engagements'} / share`}
                      value={count(creator[metric].results)}
                      note={formatShare(
                        metric === 'cpv'
                          ? creator.viewShare
                          : creator.engagementShare
                      )}
                    />
                  </dl>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium outline-offset-4">
                      Your collaboration history in selected campaigns
                    </summary>
                    <div className="mt-5 flex flex-col gap-6">
                      <CohortNote cohort={creator.cpv} metric="cpv" />
                      <CohortNote cohort={creator.cpe} metric="cpe" />
                      {history && (
                        <>
                          <HistoryValues value={history} />
                          <Timing value={history} />
                          <RevisionFeedback value={history} />
                        </>
                      )}
                      <div>
                        <h4 className="mb-2 text-sm font-medium">
                          Explore campaign & video evidence
                        </h4>
                        <ul className="flex flex-col gap-2">
                          {campaigns.map((row) => (
                            <li key={row.id}>
                              <Link
                                className={linkClass}
                                href={`/campaigns/${row.id}`}
                              >
                                {row.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <Pages filters={filters} field="creatorPage" {...selection} />
        </CardContent>
      </Card>
    </section>
  );
}

function Operations({ report }: { report: Report }) {
  const history = report.history.aggregate;
  const waiting = stageRows(history)
    .flatMap((stage) =>
      stage.metric.waiting.map((row) => ({
        ...row,
        stage: stage.label,
        stageId: stage.id,
      }))
    )
    .sort(
      (a, b) =>
        b.durationMs - a.durationMs ||
        a.dealId.localeCompare(b.dealId) ||
        (a.videoId ?? '').localeCompare(b.videoId ?? '') ||
        a.stageId.localeCompare(b.stageId)
    );
  const selection = insightPage(waiting, report.filters.waitingPage);
  const context = new Map(
    report.campaigns.flatMap((campaign) =>
      campaign.metrics.deals.map(
        (deal) => [deal.id, { campaign, deal }] as const
      )
    )
  );
  return (
    <section
      id="collaboration"
      aria-labelledby="collaboration-title"
      className="scroll-mt-24"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="collaboration-title">Delivery & collaboration</h2>
          </CardTitle>
          <CardDescription>
            Distinct deals in selected campaigns. Sample counts and limited
            evidence stay visible; ongoing work is not a failed collaboration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-7">
          <HistoryValues value={history} />
          <Timing value={history} />
          <div id="waiting-work" className="scroll-mt-24">
            <h3 className="mb-3 text-sm font-medium">Currently waiting work</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {waiting.length} waiting intervals across{' '}
              {new Set(waiting.map((row) => row.dealId)).size} deals.
              Delivery/review waits are deal-level; replacements can be
              video-level. Longest recorded wait first.
            </p>
            {waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recorded open waits in this selection. Missing historical
                events do not imply immediate delivery.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {selection.rows.map((row) => {
                  const item = context.get(row.dealId);
                  return (
                    <li
                      key={`${row.stageId}-${row.dealId}-${row.videoId}-${row.reviewCycleId}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/deals/${row.dealId}`}
                          className={`${linkClass} break-words`}
                        >
                          {item?.campaign.name} · @{item?.deal.creatorHandle}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.stage}
                          {row.videoId
                            ? ` · video ${item?.deal.videos.find((video) => video.id === row.videoId)?.ordinal ?? row.videoId.slice(0, 8)}`
                            : ' · deal'}{' '}
                          · since {formatDeadlineUtc(new Date(row.startedAt))}
                        </p>
                      </div>
                      <span className="font-mono text-sm">
                        {formatDuration(row.durationMs)} waiting
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Pages
              filters={report.filters}
              field="waitingPage"
              {...selection}
            />
          </div>
          <RevisionFeedback value={history} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Initial-delivery punctuality requires a recorded agreement. An
            extension accepted after a missed deadline does not erase it. Legacy
            history is excluded where incomplete, not labeled on time or
            revision-free. Revision/final-approval deadlines and delay fault are
            not measured.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export function OverallInsightsReport({ report }: { report: Report }) {
  const { filters, overall } = report;
  return (
    <div
      className="flex min-w-0 flex-col gap-6 py-4"
      aria-label="Overall insights"
    >
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-brand uppercase">
          Your creator marketing
        </p>
        <h1 className="page-title flex items-center gap-3">
          <ChartBar aria-hidden />
          Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Compare recorded results, costs and collaboration across your
          campaigns.
        </p>
      </header>
      <InsightFiltersForm
        key={insightHref(filters)}
        filters={filters}
        options={report.options}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-medium">
          {report.campaigns.length} selected campaigns ·{' '}
          {overall.creators.length} creators · {overall.totalDeals} deals
        </p>
        <p className="text-xs text-muted-foreground">
          As of {formatDeadlineUtc(new Date(report.asOf))}
        </p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {filters.from || filters.to
          ? `Latest recorded results for campaigns created ${filters.from ? `from ${filters.from}` : 'at any time'} ${filters.to ? `through ${filters.to}` : 'onward'} (UTC).`
          : 'All campaign creation dates. Latest recorded results.'}{' '}
        Lifetime-to-current costs and history for this selection, not activity
        earned during a reporting period.
        {filters.status &&
          ` Current status: ${campaignStatusLabel(filters.status)}.`}
      </p>
      {report.campaigns.length === 0 ? (
        <EmptyState
          align="start"
          title={
            report.options.length
              ? 'No campaigns match these filters'
              : 'No campaigns yet'
          }
          description={
            report.options.length
              ? 'Clear or adjust the filters to explore your campaigns.'
              : 'Create a campaign and issue offers to start building your own performance and collaboration record.'
          }
        />
      ) : (
        <>
          <nav
            aria-label="Insight sections"
            className="flex flex-wrap gap-4 text-sm"
          >
            <a href="#campaign-comparison" className={linkClass}>
              Campaigns
            </a>
            <a href="#creator-comparison" className={linkClass}>
              Creators
            </a>
            <a href="#collaboration" className={linkClass}>
              Delivery & collaboration
            </a>
          </nav>
          <MoneyAndResults model={overall} />
          {overall.duplicateVideos > 0 && (
            <Alert>
              <Info aria-hidden />
              <AlertTitle>
                Repeated identities across selected campaigns
              </AlertTitle>
              <AlertDescription>
                {overall.duplicateVideos} current video records share a known
                TikTok identity. Affected deals are excluded from every
                comparison in this report. Raw totals may double-count records
                and are not unique reach. A standalone campaign can have
                different exclusions because its selection is narrower.
              </AlertDescription>
            </Alert>
          )}
          {overall.staleVideos > 0 && (
            <Alert>
              <Info aria-hidden />
              <AlertTitle>Some reported counts are marked stale</AlertTitle>
              <AlertDescription>
                {overall.staleVideos} current records contain older reported
                counts. They remain observations, not current platform
                measurements.
              </AlertDescription>
            </Alert>
          )}
          <CampaignComparison report={report} />
          <CreatorComparison report={report} />
          <Operations report={report} />
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium outline-offset-4">
              How to read these comparisons
            </summary>
            <div className="mt-4 flex flex-col gap-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                Every section follows the same campaign selection. Creator
                history includes only this brand&apos;s deals in those
                campaigns, not a platform-wide score or unselected
                collaborations.
              </p>
              <p>
                CPV and CPE are ratios of eligible cost to eligible results, not
                averages of campaign ratios. Known zero results retain their
                cost; zero total results cannot produce a ratio. Contribution
                shares compare the same eligible set of deals.
              </p>
              <p>
                Campaign dates select creation dates, not when views or
                engagement occurred. Counts can be differently aged and
                campaigns can have different objectives. This report supports
                investigation, not automated spending recommendations, causal
                ROI or unique reach.
              </p>
              <p>
                Follow a campaign to its deal and video evidence for metrics,
                versions, feedback and deadline agreements.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
