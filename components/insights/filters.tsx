'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { campaignStatusLabel } from '@/lib/campaigns/status';
import type { CampaignStatus } from '@/db/schema';
import { insightHref, type InsightFilters } from '@/lib/brands/insight-filters';

const statuses: CampaignStatus[] = [
  'draft',
  'confirmed',
  'funded',
  'in_progress',
  'completed',
  'cancelled',
];
const selectClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring';

export function InsightFiltersForm({
  filters,
  options,
}: {
  filters: InsightFilters;
  options: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState('');
  const matches = options.filter((option) =>
    option.name.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <form
      action="/insights"
      method="get"
      aria-label="Insight filters"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <FieldGroup>
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="insight-status">
              Current campaign status
            </FieldLabel>
            {/* Native selects and checkboxes keep the GET filters usable without JavaScript. */}
            <select
              id="insight-status"
              name="status"
              defaultValue={filters.status ?? ''}
              className={selectClass}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {campaignStatusLabel(status)}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="insight-from">
              Campaign created from (UTC)
            </FieldLabel>
            <Input
              id="insight-from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ''}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="insight-to">
              Campaign created through (UTC)
            </FieldLabel>
            <Input
              id="insight-to"
              name="to"
              type="date"
              defaultValue={filters.to ?? ''}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="insight-sort">Campaign order</FieldLabel>
            <select
              id="insight-sort"
              name="sort"
              defaultValue={filters.sort}
              className={selectClass}
            >
              <option value="spend">Settled spend, highest first</option>
              <option value="views">Recorded views, highest first</option>
              <option value="engagement">
                Recorded engagement, highest first
              </option>
              <option value="cpv">Comparable CPV, lowest first</option>
              <option value="cpe">Comparable CPE, lowest first</option>
              <option value="name">Campaign name</option>
            </select>
          </Field>
        </div>
        <input type="hidden" name="metric" value={filters.metric} />
        <details>
          <summary className="cursor-pointer rounded-md py-1 text-sm font-medium outline-offset-4">
            {filters.campaignIds.length
              ? `${filters.campaignIds.length} campaigns selected`
              : 'All campaigns'}{' '}
            · choose campaigns
          </summary>
          <FieldSet className="mt-4">
            <FieldLegend>Select campaigns</FieldLegend>
            <FieldDescription>
              Leave all unchecked for all campaigns. Status and created-date
              filters also apply.
            </FieldDescription>
            {options.length > 10 && (
              <Field>
                <FieldLabel htmlFor="campaign-search">
                  Find a campaign
                </FieldLabel>
                <Input
                  id="campaign-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <FieldDescription>
                  {matches.length} matching campaigns. Searching does not change
                  checked selections.
                </FieldDescription>
              </Field>
            )}
            <FieldGroup className="max-h-60 overflow-y-auto p-1">
              {options.map((option) => (
                <div
                  key={option.id}
                  hidden={
                    !option.name.toLowerCase().includes(search.toLowerCase())
                  }
                >
                  <Field orientation="horizontal">
                    <input
                      id={`campaign-${option.id}`}
                      type="checkbox"
                      name="campaign"
                      value={option.id}
                      defaultChecked={filters.campaignIds.includes(option.id)}
                      className="size-4 shrink-0 accent-brand"
                    />
                    <FieldLabel
                      htmlFor={`campaign-${option.id}`}
                      className="min-w-0 break-words"
                    >
                      {option.name}
                    </FieldLabel>
                  </Field>
                </div>
              ))}
            </FieldGroup>
            {filters.campaignIds.length > 0 && (
              <Link
                className="text-sm underline underline-offset-4"
                href={insightHref(filters, {
                  campaignIds: [],
                  campaignPage: 1,
                  creatorPage: 1,
                  waitingPage: 1,
                })}
              >
                Use all campaigns
              </Link>
            )}
          </FieldSet>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Apply filters</Button>
          <Link
            href="/insights"
            className={buttonVariants({ variant: 'outline' })}
          >
            Clear filters
          </Link>
          <p className="text-xs text-muted-foreground">
            Latest recorded counts for these campaigns, not results earned
            during the selected dates.
          </p>
        </div>
      </FieldGroup>
    </form>
  );
}
