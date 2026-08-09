import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import {
  getCartRunningTotal,
  listCartItems,
} from '@/lib/campaigns/cart-queries';
import { getCampaignForBrand } from '@/lib/campaigns/queries';
import { formatEtb } from '@/lib/money';

import { EmptyState } from '@/components/feedback/empty-state';

export const runtime = 'nodejs';

/**
 * Campaign detail and cart view (KAN-30).
 *
 * Shows the campaign's budget, running total, and cart items (pending deals).
 */
export default async function CampaignCartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaign = await getCampaignForBrand(id, profile.id);
  if (!campaign) notFound();

  const [items, runningTotal] = await Promise.all([
    listCartItems(campaign.id),
    getCartRunningTotal(campaign.id),
  ]);

  const remainingBudget = campaign.budget - runningTotal;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 py-4">
      <Link
        href="/campaigns"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to campaigns
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {campaign.name}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="secondary" className="capitalize">
              {campaign.status}
            </Badge>
            <span>•</span>
            <span>
              Created on{' '}
              {new Date(campaign.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        {campaign.status === 'draft' && (
          <div className="flex items-center gap-3">
            <Link
              href={`/campaigns/${campaign.id}/edit`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Edit brief
            </Link>
            <Link
              href="/discover"
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              Find creators
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-4">
          <h2 className="text-xl font-semibold tracking-tight">
            Cart ({items.length})
          </h2>

          {items.length === 0 ? (
            <EmptyState
              title="Your cart is empty"
              description="Browse the marketplace to find creators and add them to this campaign."
              action={
                <Link
                  href="/discover"
                  className={buttonVariants({ variant: 'default', size: 'sm' })}
                >
                  Browse creators
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item.id}>
                  <Card>
                    <CardContent className="p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/discover/${item.creatorId}`}
                            className="font-semibold text-lg hover:underline"
                          >
                            {item.creator.tiktokHandle}
                          </Link>
                          {item.tier?.id && (
                            <Badge variant="outline" className="text-xs">
                              {item.tier.name} Tier
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground capitalize">
                          {item.creator.niche} creator
                        </p>
                      </div>

                      <div className="flex items-center gap-8 text-right">
                        <div className="flex flex-col">
                          <span className="text-sm text-muted-foreground">
                            Rate
                          </span>
                          <span className="font-medium">
                            {formatEtb(item.unitPrice)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm text-muted-foreground">
                            Videos
                          </span>
                          <span className="font-medium">
                            x{item.videoCount}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm text-muted-foreground">
                            Total
                          </span>
                          <span className="font-semibold text-primary">
                            {formatEtb(item.totalPrice)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="md:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Budget Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Total Budget</span>
                <span className="font-medium">
                  {formatEtb(campaign.budget)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Running Total</span>
                <span className="font-medium">{formatEtb(runningTotal)}</span>
              </div>
              <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Remaining</span>
                <span className="font-semibold text-primary">
                  {formatEtb(remainingBudget)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
