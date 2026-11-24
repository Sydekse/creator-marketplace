import type { CampaignInsightModel, CreatorInsight } from './insight-model';
import type { CollaborationSummary } from './insight-history';

export function comparisonRows(
  model: CampaignInsightModel,
  metric: 'cpv' | 'cpe'
) {
  return [...model.creators].sort((a, b) => {
    const x = a[metric].ratio;
    const y = b[metric].ratio;
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    return (
      (x ?? 0) - (y ?? 0) ||
      a.handle.localeCompare(b.handle) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function contributionRows(
  creators: CreatorInsight[],
  metric: 'cpv' | 'cpe'
) {
  const percent = (n: number | null) => (n === null ? null : n * 100);
  return creators.map((c) => ({
    id: c.id,
    label: `@${c.handle}`,
    primary: percent(
      metric === 'cpv' ? c.viewCostShare : c.engagementCostShare
    ),
    secondary: percent(metric === 'cpv' ? c.viewShare : c.engagementShare),
  }));
}

export function efficiencyRows(
  creators: CreatorInsight[],
  metric: 'cpv' | 'cpe'
) {
  return creators.map((c) => ({
    id: c.id,
    label: `@${c.handle}`,
    primary: c[metric].ratio,
  }));
}

export function stageRows(summary: CollaborationSummary) {
  return [
    {
      id: 'delivery',
      label: 'Full delivery',
      metric: summary.timing.firstFullDelivery,
    },
    {
      id: 'review',
      label: 'Review decision',
      metric: summary.timing.reviewDecision,
    },
    {
      id: 'revision',
      label: 'Replacement',
      metric: summary.timing.resubmission,
    },
  ].map((row) => ({
    ...row,
    primary:
      row.metric.medianMs === null ? null : row.metric.medianMs / 3_600_000,
  }));
}
