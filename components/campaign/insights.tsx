import Link from 'next/link';
import { ChartBar, Info, Clock } from '@phosphor-icons/react/dist/ssr';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/feedback/empty-state';
import type { CampaignInsights } from '@/lib/campaigns/insights';
import {
  formatEfficiency,
  formatShare,
  INSIGHT_FIELDS,
  type CampaignInsightModel,
  type EfficiencyCohort,
} from '@/lib/campaigns/insight-model';
import {
  comparisonRows,
  contributionRows,
  efficiencyRows,
  stageRows,
} from '@/lib/campaigns/insight-display';
import {
  formatDuration,
  type CollaborationSummary,
} from '@/lib/campaigns/insight-history';
import { formatEtb } from '@/lib/money';
import { InsightChart } from './insight-chart';

const count = (n: number | null) =>
  n === null ? 'Pending' : n.toLocaleString('en-US');
const rate = (n: number, d: number) => `${n} / ${d}`;

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xl tracking-tight text-foreground tabular-nums">
        {value}
      </dd>
      <dd className="text-xs leading-relaxed text-muted-foreground">{note}</dd>
    </div>
  );
}

function CohortNote({
  cohort,
  metric,
}: {
  cohort: EfficiencyCohort;
  metric: 'cpv' | 'cpe';
}) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {cohort.deals} completed measured deals · {cohort.videos} ordered videos ·{' '}
      {formatEtb(cohort.cost)} included cost. {cohort.excludedDeals} deals
      excluded.{' '}
      {metric === 'cpv'
        ? 'Every ordered video needs views.'
        : 'Every ordered video needs likes, comments and shares.'}{' '}
      Known duplicates are excluded. Measured zero results retain their cost; a
      zero total denominator is unavailable.
    </p>
  );
}

function Comparison({
  model,
  metric,
}: {
  model: CampaignInsightModel;
  metric: 'cpv' | 'cpe';
}) {
  const creators = comparisonRows(model, metric);
  const cohort = model[metric];
  const resultLabel = metric === 'cpv' ? 'views' : 'engagements';
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {metric === 'cpv'
            ? 'Cost & view contribution'
            : 'Cost & engagement contribution'}
        </CardTitle>
        <CardDescription>
          Same completed-deal cohort. Cost share alongside recorded{' '}
          {resultLabel} share.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <CohortNote cohort={cohort} metric={metric} />
        {cohort.deals ? (
          <>
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-5 rounded-sm bg-brand-strong"
                  aria-hidden
                />
                Cost share
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-5 rounded-sm bg-foreground"
                  aria-hidden
                />
                {resultLabel === 'views' ? 'View' : 'Engagement'} share
              </span>
            </div>
            <InsightChart
              rows={contributionRows(creators, metric)}
              primaryLabel="Cost share (%)"
              secondaryLabel={`${resultLabel} share (%)`}
              unit="%"
            />
          </>
        ) : (
          <EmptyState
            align="start"
            title="Metrics pending"
            description={`Comparable ${resultLabel} will appear when a completed deal has all ordered videos measured. Costs and delivery progress remain available above.`}
          />
        )}
        <div
          className="overflow-x-auto rounded-lg border border-border"
          tabIndex={0}
          role="region"
          aria-label={`${metric.toUpperCase()} exact creator values`}
        >
          <table className="w-full min-w-[490px] text-left text-xs">
            <caption className="sr-only">
              Creator contributions and {metric.toUpperCase()}, ordered by
              available {metric.toUpperCase()} then creator handle. Unavailable
              values last.
            </caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {[
                  'Creator',
                  'Cost / share',
                  `${resultLabel} / share`,
                  metric.toUpperCase(),
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <th
                    scope="row"
                    className="max-w-36 break-words px-3 py-3 font-medium"
                  >
                    @{c.handle}
                    <span className="mt-1 block font-normal text-muted-foreground">
                      {c[metric].deals} deals · {c[metric].videos} videos
                    </span>
                  </th>
                  <td className="px-3 py-3 font-mono">
                    {c[metric].deals
                      ? formatEtb(c[metric].cost)
                      : 'Unavailable'}
                    <span className="mt-1 block text-muted-foreground">
                      {formatShare(
                        metric === 'cpv'
                          ? c.viewCostShare
                          : c.engagementCostShare
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono">
                    {count(c[metric].results)}
                    <span className="mt-1 block text-muted-foreground">
                      {formatShare(
                        metric === 'cpv' ? c.viewShare : c.engagementShare
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono">
                    {formatEfficiency(c[metric].ratio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cohort.deals > 0 && (
          <details className="group">
            <summary className="cursor-pointer rounded-md py-2 text-sm font-medium outline-offset-4">
              View {metric.toUpperCase()} chart{' '}
              <span className="font-normal text-muted-foreground">
                · ETB per {metric === 'cpv' ? 'view' : 'engagement'}
              </span>
            </summary>
            <InsightChart
              rows={efficiencyRows(creators, metric)}
              primaryLabel={metric.toUpperCase()}
              unit=" ETB"
            />
          </details>
        )}
        <p className="text-xs text-muted-foreground">
          {creators.length === 1
            ? 'One creator: these are recorded values, not a ranking.'
            : 'Ordered by available cost per result, not a quality ranking.'}{' '}
          Costs are recorded creator costs, not all-in business costs.
        </p>
      </CardContent>
    </Card>
  );
}

function HistoryValues({ value }: { value: CollaborationSummary }) {
  return (
    <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <Stat
        label="Offers ever accepted / issued"
        value={rate(value.acceptance.accepted, value.acceptance.issued)}
        note={`${formatShare(value.acceptance.rate)} · ${value.acceptance.pending} pending · ${value.acceptance.declined} declined · ${value.acceptance.expired} expired`}
      />
      <Stat
        label="Completed / ever funded"
        value={rate(value.completion.completed, value.completion.funded)}
        note={`${formatShare(value.completion.rate)} · ${value.completion.inProgress} ongoing · ${value.completion.refunded} refunded. Ongoing does not mean failed.`}
      />
      <Stat
        label="Deals revised / reached review"
        value={rate(value.dealRevisions.revised, value.dealRevisions.reviewed)}
        note={`${value.dealRevisions.open} open / ${value.dealRevisions.closed} closed reviews; revised: ${value.dealRevisions.revisedOpen} open / ${value.dealRevisions.revisedClosed} closed. ${value.dealRevisions.brandRevised} brand / ${value.dealRevisions.adminRevised} admin / ${value.dealRevisions.unknownActorRevised} unknown-actor revised deals.`}
      />
      <Stat
        label="Videos revised / fully captured reviewed"
        value={rate(
          value.videoRevisions.revised,
          value.videoRevisions.reviewed
        )}
        note={`${value.videoRevisions.rounds} recorded rounds, not a probability. ${value.videoRevisions.brandRounds} brand / ${value.videoRevisions.adminRounds} admin / ${value.videoRevisions.unknownActorRounds} unknown. ${value.videoRevisions.excludedIncomplete} limited histories excluded.`}
      />
      <Stat
        label="Approved without revision / batch approved"
        value={rate(
          value.approvalWithoutRevision.withoutRevision,
          value.approvalWithoutRevision.approved
        )}
        note={`${value.approvalWithoutRevision.excludedIncomplete} limited histories excluded. ${value.approvalWithoutRevision.adminReleased} admin-released videos are not brand approvals (${value.dealRevisions.adminReleased} deals).`}
      />
    </dl>
  );
}

function Workflow({ value }: { value: CollaborationSummary }) {
  const rows = stageRows(value);
  return (
    <div className="flex flex-col gap-5">
      <h3 className="flex items-center gap-2 text-base font-medium">
        <Clock size={18} aria-hidden />
        Workflow timing
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your brand’s history. Median completed elapsed time, not active effort
        or fault. Full delivery starts at funding; reviews start when the
        complete deal is ready; replacements start at the recorded rejection.
      </p>
      {rows.some((r) => r.primary !== null) && (
        <InsightChart rows={rows} primaryLabel="Median hours" unit=" h" />
      )}
      <dl className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm font-medium">{r.label}</dt>
              <dd className="font-mono text-sm">
                {formatDuration(r.metric.medianMs)}{' '}
                <span className="text-xs text-muted-foreground">
                  · n={r.metric.n}
                </span>
              </dd>
            </div>
            <dd className="text-xs text-muted-foreground">
              {r.metric.waiting.length} currently waiting ·{' '}
              {r.metric.interrupted.length} interrupted intervals (not completed
              reviews) · {r.metric.excluded} unavailable intervals
            </dd>
            {r.metric.waiting.length > 0 && (
              <dd>
                <ul className="flex flex-col gap-2">
                  {r.metric.waiting.map((w, i) => (
                    <li
                      key={`${w.dealId}-${w.videoId}-${i}`}
                      className="flex justify-between gap-3 text-xs"
                    >
                      <Link
                        className="underline underline-offset-4"
                        href={`/deals/${w.dealId}`}
                      >
                        Open waiting deal
                        {w.videoId ? ' · video replacement' : ''}
                      </Link>
                      <span className="font-mono">
                        {formatDuration(w.durationMs)} waiting
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            )}
          </div>
        ))}
      </dl>
      <details>
        <summary className="cursor-pointer rounded-md py-2 text-sm font-medium outline-offset-4">
          Recorded timing observations
        </summary>
        <div className="flex flex-col gap-4 pt-3">
          {rows.map((r) => (
            <div key={r.id}>
              <h4 className="text-xs font-semibold">{r.label}</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {[
                  ...r.metric.samples.map((s) => ({
                    ...s,
                    interrupted: false,
                  })),
                  ...r.metric.interrupted.map((s) => ({
                    ...s,
                    interrupted: true,
                  })),
                ].map((s, i) => (
                  <li
                    key={`${s.dealId}-${i}`}
                    className="text-xs text-muted-foreground"
                  >
                    {s.startedAt} → {s.endedAt} · {formatDuration(s.durationMs)}{' '}
                    · {s.actorRole}
                    {s.interrupted ? ' · interrupted' : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function CampaignInsightsPanel({
  insights,
}: {
  insights: CampaignInsights;
}) {
  const model = insights.campaign;
  const history = insights.history.aggregate;
  return (
    <section
      id="campaign-insights"
      aria-labelledby="insights-title"
      className="flex min-w-0 flex-col gap-6"
    >
      <noscript>
        <style>{'.insight-visual { display: none !important; }'}</style>
        <p className="text-sm text-muted-foreground">
          Charts need JavaScript. All exact values and evidence remain available
          below.
        </p>
      </noscript>
      <header className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-brand-strong uppercase">
          <ChartBar size={16} aria-hidden />
          Recorded performance
        </p>
        <h2
          id="insights-title"
          className="font-display text-3xl tracking-tight"
        >
          Campaign insights
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          What your creator costs produced — and where collaboration is waiting.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Cost, results & delivery</CardTitle>
          <CardDescription>
            Current campaign · observed results, not unique reach or ROI.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="Settled spend"
              value={formatEtb(model.settled)}
              note={`Payouts + commission, counted once. ${formatEtb(model.refunded)} refunded separately.`}
            />
            <Stat
              label="Committed cost"
              value={formatEtb(model.committed)}
              note="Status-aware contracts, including pending offers. Not the amount paid out."
            />
            <Stat
              label="Comparable CPV"
              value={formatEfficiency(model.cpv.ratio)}
              note={`${model.cpv.deals} completed measured deals · ${model.cpv.videos} videos · ${formatEtb(model.cpv.cost)} cost`}
            />
            <Stat
              label="Comparable CPE"
              value={formatEfficiency(model.cpe.ratio)}
              note={`${model.cpe.deals} completed measured deals · ${model.cpe.videos} videos · ${formatEtb(model.cpe.cost)} cost`}
            />
            <Stat
              label="Deals completed"
              value={rate(model.completedDeals, model.totalDeals)}
              note={`${model.submittedVideos} submitted / ${model.orderedVideos} ordered videos across all issued deals.`}
            />
          </dl>
          <div className="rounded-lg bg-muted p-4">
            <h3 className="text-xs font-semibold">
              Recorded totals · all deal statuses
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-4">
              {INSIGHT_FIELDS.map((field) => (
                <div key={field}>
                  <dt className="text-xs text-muted-foreground capitalize">
                    {field}
                  </dt>
                  <dd className="mt-1 font-mono text-lg">
                    {count(model.totals[field])}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {model.coverage[field]} / {model.orderedVideos} videos
                    measured
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Creator/admin reported. These raw totals can include ongoing or
            refunded deals; efficiency uses separate completed-deal cohorts.
            Unknown is not zero. Record update times below do not mean every
            field was measured then. No TikTok verification or age-matched
            comparison.
          </p>
        </CardContent>
      </Card>
      {model.duplicateVideos > 0 && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Repeated video identity</AlertTitle>
          <AlertDescription>
            {model.duplicateVideos} current records share a known TikTok video
            identity. Affected deals are excluded from comparisons until
            resolved. Raw totals may double-count these records; they are not
            unique videos. Opaque short links are not guessed.
          </AlertDescription>
        </Alert>
      )}
      {model.staleVideos > 0 && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Some reported counts are marked stale</AlertTitle>
          <AlertDescription>
            {model.staleVideos}{' '}
            {model.staleVideos === 1 ? 'video has' : 'videos have'} older
            recorded counts. They remain reported observations, not current
            platform measurements.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Comparison model={model} metric="cpv" />
        <Comparison model={model} metric="cpe" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your collaboration history</CardTitle>
          <CardDescription>
            Across your brand’s campaigns, for the creators in this campaign
            only. No platform-wide score.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-7">
          <HistoryValues value={history} />
          {insights.history.creators.map((creator) => (
            <details
              key={creator.creatorId}
              className="rounded-lg border border-border p-4"
            >
              <summary className="cursor-pointer text-sm font-medium outline-offset-4">
                @
                {model.creators.find((c) => c.id === creator.creatorId)?.handle}{' '}
                · collaboration evidence
              </summary>
              <div className="flex flex-col gap-6 pt-5">
                <HistoryValues value={creator} />
                <Workflow value={creator} />
                <dl className="flex flex-col gap-2">
                  {creator.revisionReasons.map((reason) => (
                    <div
                      key={reason.category}
                      className="flex justify-between gap-3 text-xs"
                    >
                      <dt>{reason.label}</dt>
                      <dd>
                        {reason.count} feedback · {reason.brand} brand /{' '}
                        {reason.admin} admin / {reason.unknownActor} unknown
                      </dd>
                    </div>
                  ))}
                </dl>
                {creator.videoRevisions.perVideo.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {creator.videoRevisions.perVideo.map((v) => (
                      <li
                        key={v.videoId}
                        className="text-xs text-muted-foreground"
                      >
                        <Link
                          className="underline underline-offset-4"
                          href={`/deals/${v.dealId}`}
                        >
                          Video {v.videoId.slice(0, 8)}
                        </Link>{' '}
                        · {v.rounds} rounds ·{' '}
                        {v.fullyCaptured ? 'fully captured' : 'limited history'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-medium">
              Recorded revision feedback
            </h3>
            <p className="text-xs text-muted-foreground">
              Category counts describe reported feedback, not responsibility.
              Unknown reasons stay unknown.
            </p>
            <dl className="flex flex-col gap-3">
              {history.revisionReasons.map((reason) => (
                <div
                  key={reason.category}
                  className="flex flex-wrap justify-between gap-2 text-xs"
                >
                  <dt>{reason.label}</dt>
                  <dd className="font-mono">
                    {reason.count} · {reason.brand} brand / {reason.admin} admin
                    / {reason.unknownActor} unknown
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <Workflow value={history} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Limited legacy evidence is excluded from history-dependent measures,
            never treated as an instant delivery or revision-free approval.
            Waiting times as of{' '}
            {new Date(insights.asOf).toLocaleString('en-US', {
              timeZone: 'UTC',
            })}{' '}
            UTC. Agreed deadlines and punctuality are not yet measured.
          </p>
        </CardContent>
      </Card>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium outline-offset-4">
          Deal & video efficiency evidence
        </summary>
        <div className="flex flex-col gap-6 pt-5">
          {model.deals.map((d) => (
            <div key={d.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  className="text-sm font-medium underline underline-offset-4"
                  href={`/deals/${d.id}`}
                >
                  @{d.creatorHandle} · {d.videoCount} ordered videos
                </Link>
                <Chip tone="gray">{d.status.replaceAll('_', ' ')}</Chip>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatEtb(d.totalPrice)} deal cost · CPV{' '}
                {formatEfficiency(d.cpv)} · CPE {formatEfficiency(d.cpe)} ·
                Views {d.coverage.views}/{d.videoCount}, likes{' '}
                {d.coverage.likes}/{d.videoCount}, comments{' '}
                {d.coverage.comments}/{d.videoCount}, shares {d.coverage.shares}
                /{d.videoCount} measured
              </p>
              {d.videos.map((v) => (
                <div key={v.id} className="rounded-lg bg-muted p-3 text-xs">
                  <p className="font-medium">
                    Video {v.ordinal}{' '}
                    {v.duplicate
                      ? '· repeated identity, comparison suppressed'
                      : ''}
                  </p>
                  <p className="mt-2 font-mono">
                    CPV {formatEfficiency(v.cpv)} · CPE{' '}
                    {formatEfficiency(v.cpe)}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    {v.source ? `${v.source} reported` : 'Metrics pending'}
                    {v.updatedAt
                      ? ` · record last updated ${new Date(v.updatedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`
                      : ''}
                    {v.stale ? ' · marked stale' : ''}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
