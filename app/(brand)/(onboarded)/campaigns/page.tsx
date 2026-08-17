import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listCampaignsByBrand } from '@/lib/campaigns/queries';
import { formatEtb } from '@/lib/money';

export const runtime = 'nodejs';

/**
 * Campaigns list page for brands (KAN-26, US-003, AC-007).
 *
 * Every campaign the brand owns, whatever its status — a confirmed campaign is
 * still theirs, and a draft-only list would drop it from view the moment they
 * sent its offers.
 */
export default async function CampaignsPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaigns = await listCampaignsByBrand(profile.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-4">
      <PageHeader
        title="Campaigns"
        description="Manage your campaign briefs and review creator commitments."
        action={
          <Link
            href="/campaigns/new"
            className={buttonVariants({ variant: 'default', size: 'default' })}
          >
            New campaign
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign brief with a budget and goals to start discovering and booking creators."
          action={
            <Link
              href="/campaigns/new"
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              Create your first campaign
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {campaigns.map((camp) => (
            <li key={camp.id}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg">{camp.name}</CardTitle>
                  <CardDescription>
                    Created on{' '}
                    {new Date(camp.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </CardDescription>
                  <CardAction>
                    <Badge variant="secondary" className="capitalize">
                      {camp.status}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Budget
                      </span>
                      <span className="font-semibold text-foreground">
                        {formatEtb(camp.budget)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Target Videos
                      </span>
                      <span className="font-semibold text-foreground">
                        {camp.desiredVideos}{' '}
                        {camp.desiredVideos === 1 ? 'video' : 'videos'}
                      </span>
                    </div>
                  </div>

                  {camp.goal && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {camp.goal}
                    </p>
                  )}

                  <div className="mt-2 pt-2 border-t border-border flex items-center justify-end">
                    {/*
                      A confirmed campaign has no brief to edit — the edit page
                      answers with a "cannot be edited" alert and a way back.
                      Sending them to the campaign itself is the useful link
                      once offers are out, and this list only shows non-draft
                      campaigns at all because confirmation exists.
                    */}
                    {camp.status === 'draft' ? (
                      <Link
                        href={`/campaigns/${camp.id}/edit`}
                        className={buttonVariants({
                          variant: 'outline',
                          size: 'sm',
                        })}
                      >
                        Edit brief
                      </Link>
                    ) : (
                      <Link
                        href={`/campaigns/${camp.id}`}
                        className={buttonVariants({
                          variant: 'outline',
                          size: 'sm',
                        })}
                      >
                        View campaign
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
