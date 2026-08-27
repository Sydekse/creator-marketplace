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
  'h-11 w-full rounded-xl border-neutral-700 bg-neutral-800 px-3.5 text-sm text-neutral-50 shadow-none hover:border-neutral-500 focus-visible:border-neutral-50 focus-visible:ring-neutral-50/20 [&_svg]:text-neutral-400';

const popupClass =
  'rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.7)] ring-neutral-50/10';

const itemClass =
  'rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap text-neutral-100 data-[highlighted]:bg-neutral-800 data-[highlighted]:text-neutral-50';

export function AddToCartForm({ creatorId, campaigns }: AddToCartFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '');
  const [videoCount, setVideoCount] = useState(1);

  if (campaigns.length === 0) {
    return (
      <section className="flex flex-col gap-3 rounded-[24px] bg-neutral-900 p-6 text-neutral-50 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.45)] sm:p-8">
        <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
          Shortlist
        </p>
        <h2 className="font-display text-2xl font-medium tracking-tight">
          Add to a campaign
        </h2>
        <p className="max-w-[36ch] text-sm leading-relaxed text-neutral-400">
          {NO_DRAFT_CAMPAIGN_MESSAGE}
        </p>
        <Button type="button" size="xl" className="mt-2 w-full" disabled>
          {ADD_TO_CAMPAIGN_LABEL}
        </Button>
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
    <section className="flex flex-col gap-5 rounded-[24px] bg-neutral-900 p-6 text-neutral-50 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.45)] sm:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
          Shortlist
        </p>
        <h2 className="font-display text-2xl font-medium tracking-tight">
          Add to a campaign
        </h2>
        <p className="max-w-[36ch] text-sm leading-relaxed text-neutral-400">
          Pick a draft and how many videos you want from this creator.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2 text-sm">
          <span
            id="add-to-cart-campaign-label"
            className="font-medium text-neutral-200"
          >
            Select draft campaign
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
                <SelectItem key={camp.id} value={camp.id} className={itemClass}>
                  {camp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-neutral-200">Videos</span>
          <VideoStepper
            name="videoCount"
            value={videoCount}
            onChange={setVideoCount}
          />
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[13px] leading-snug text-red-300"
          >
            {formError}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={loading}
          size="xl"
          className="mt-1 w-full bg-neutral-50 text-neutral-900 hover:bg-neutral-100"
        >
          {loading ? 'Adding...' : ADD_TO_CAMPAIGN_LABEL}
        </Button>
      </form>
    </section>
  );
}
