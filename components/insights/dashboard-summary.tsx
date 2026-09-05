import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';
import { readBrandInsightSummary } from '@/lib/brands/insights';
import { formatEfficiency } from '@/lib/campaigns/insight-model';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export async function OverallInsightSummary() {
  const summary = await readBrandInsightSummary();
  const model = summary.overall;
  return (
    <Card aria-label="Overall insights summary">
      <CardHeader>
        <CardTitle>Across your campaigns</CardTitle>
        <CardDescription>
          All time · {summary.campaignCount} campaigns · {summary.creatorCount}{' '}
          creators. Latest reported results, not the 12-week spend period.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Recorded views</dt>
            <dd className="mt-1 font-mono text-lg">
              {model.totals.views?.toLocaleString('en-US') ?? 'Pending'}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {model.coverage.views} / {model.orderedVideos} ordered videos
              measured
            </dd>
          </div>
          {(['cpv', 'cpe'] as const).map((metric) => (
            <div key={metric}>
              <dt className="text-xs text-muted-foreground">
                Comparable {metric.toUpperCase()}
              </dt>
              <dd className="mt-1 font-mono text-lg">
                {formatEfficiency(model[metric].ratio)}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {model[metric].deals} completed measured deals ·{' '}
                {model[metric].excludedDeals} excluded
              </dd>
            </div>
          ))}
        </dl>
        {model.duplicateVideos > 0 && (
          <p className="text-xs text-muted-foreground">
            Repeated video identities affect {model.duplicateVideos} records.
            Raw totals may double-count; affected deals are excluded from
            comparisons.
          </p>
        )}
        <Link
          href="/insights"
          className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
        >
          View Insights
          <ArrowUpRight data-icon="inline-end" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
