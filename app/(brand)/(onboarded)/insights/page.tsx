import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  readBrandInsights,
  InsightSelectionError,
} from '@/lib/brands/insights';
import { parseInsightFilters } from '@/lib/brands/insight-filters';
import { OverallInsightsReport } from '@/components/insights/report';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';

export const runtime = 'nodejs';
export const metadata = { title: 'Insights' };

function InvalidSelection({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-5 py-6">
      <h1 className="page-title">Insights</h1>
      <Alert variant="destructive">
        <AlertTitle>Unable to use these filters</AlertTitle>
        <AlertDescription>
          {message} No unfiltered results have been substituted.
        </AlertDescription>
      </Alert>
      <Link
        href="/insights"
        className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
      >
        Clear filters
      </Link>
    </div>
  );
}

export default async function OverallInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('brand');
  const parsed = parseInsightFilters(await searchParams);
  if (!parsed.ok) return <InvalidSelection message={parsed.message} />;
  let report;
  try {
    report = await readBrandInsights(parsed.value);
  } catch (error) {
    if (error instanceof InsightSelectionError)
      return <InvalidSelection message={error.message} />;
    throw error;
  }
  return <OverallInsightsReport report={report} />;
}
