'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { VideoStepper } from '@/components/campaign/video-stepper';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  ADD_TO_CAMPAIGN_LABEL,
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  NO_DRAFT_CAMPAIGN_MESSAGE,
} from '@/lib/campaigns/constants';
import { cn } from '@/lib/utils';

export interface AddToCartFormProps {
  creatorId: string;
  campaigns: Array<{ id: string; name: string }>;
}

const triggerClass =
  'h-11 w-full rounded-xl border-neutral-200 bg-white px-3 text-sm text-neutral-900 shadow-none hover:border-neutral-400 focus-visible:border-brand focus-visible:ring-brand/20 [&_svg]:text-neutral-500';

const popupClass =
  'w-max min-w-(--anchor-width) max-w-72 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.45)]';

const itemClass =
  'rounded-lg py-2.5 pl-3 pr-8 text-sm font-medium whitespace-nowrap text-neutral-800 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink';

export function AddToCartForm({ creatorId, campaigns }: AddToCartFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [videoCount, setVideoCount] = useState(1);

  if (campaigns.length === 0) {
    return (
      <section className="bd-caprail bd-bookcard">
        <div className="bd-railcell">
          <span className="bd-railk">Shortlist</span>
          <h2 className="bd-booktitle">Add to a campaign</h2>
          <p className="bd-railn">{NO_DRAFT_CAMPAIGN_MESSAGE}</p>
        </div>
        <div className="bd-railcell">
          <Button type="button" size="xl" className="w-full" disabled>
            {ADD_TO_CAMPAIGN_LABEL}
          </Button>
        </div>
      </section>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading || !campaignId) return;
    setFormError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creatorId,
          videoCount,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const message =
          data?.error?.code === 'CREATOR_NOT_BOOKABLE'
            ? 'This creator is not currently bookable.'
            : data?.error?.code === 'CAMPAIGN_NOT_DRAFT'
              ? CAMPAIGN_NOT_DRAFT_MESSAGE
              : (data?.error?.message ?? 'Failed to add creator to campaign.');
        setFormError(message);
        toast.error(message);
        return;
      }

      const data = await res.json().catch(() => null);
      toast.success(
        data?.updated
          ? 'Video count updated for that creator.'
          : 'Creator added to campaign!'
      );
      router.push(`/campaigns/${campaignId}`);
    } catch {
      const message = 'An unexpected error occurred.';
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bd-caprail bd-bookcard">
      <div className="bd-railcell">
        <span className="bd-railk">Shortlist</span>
        <h2 className="bd-booktitle">Add to a campaign</h2>
        <p className="bd-railn">
          Pick a draft and how many videos you want from this creator.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bd-railcell bd-bookform"
        noValidate
      >
        <div className="bd-bookrow">
          <div className="bd-bookfield bd-bookfield--grow">
            <span id="add-to-cart-campaign-label" className="bd-disclab">
              Draft campaign
            </span>
            <input type="hidden" name="campaignId" value={campaignId} />
            <Select
              value={campaignId}
              onValueChange={(next) => {
                if (next) setCampaignId(next);
              }}
            >
              <SelectTrigger
                aria-labelledby="add-to-cart-campaign-label"
                className={cn(triggerClass)}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {campaigns.find((c) => c.id === campaignId)?.name ??
                    'Choose a campaign'}
                </span>
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className={popupClass}
              >
                {campaigns.map((camp) => (
                  <SelectItem
                    key={camp.id}
                    value={camp.id}
                    className={itemClass}
                  >
                    {camp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bd-bookfield">
            <span className="bd-disclab">Videos</span>
            <VideoStepper
              name="videoCount"
              value={videoCount}
              onChange={setVideoCount}
              tone="light"
            />
          </div>
        </div>

        {formError ? (
          <p role="alert" className="bd-bookerror">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="bd-btn bd-btn--primary bd-booksubmit"
        >
          {loading ? 'Adding...' : ADD_TO_CAMPAIGN_LABEL}
        </button>
      </form>

      <p className="bd-railfoot">
        Nothing is charged now. Money is only held when you fund accepted deals.
      </p>
    </section>
  );
}
