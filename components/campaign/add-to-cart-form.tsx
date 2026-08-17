'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import {
  ADD_TO_CAMPAIGN_LABEL,
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  NO_DRAFT_CAMPAIGN_MESSAGE,
} from '@/lib/campaigns/constants';

export interface AddToCartFormProps {
  creatorId: string;
  campaigns: Array<{ id: string; name: string }>;
}

export function AddToCartForm({ creatorId, campaigns }: AddToCartFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (campaigns.length === 0) {
    return (
      <section className="flex flex-col items-start gap-2 border-t border-border pt-8">
        <button
          type="button"
          disabled
          className={buttonVariants({ variant: 'default', size: 'sm' })}
        >
          {ADD_TO_CAMPAIGN_LABEL}
        </button>
        <p className="text-sm text-muted-foreground">
          {NO_DRAFT_CAMPAIGN_MESSAGE}
        </p>
      </section>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const campaignId = formData.get('campaignId') as string;
    const videoCount = parseInt(formData.get('videoCount') as string, 10);

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
        if (data?.error?.code === 'CREATOR_ALREADY_IN_CART') {
          toast.error('Creator is already in this campaign cart.');
        } else if (data?.error?.code === 'CREATOR_NOT_BOOKABLE') {
          toast.error('This creator is not currently bookable.');
        } else if (data?.error?.code === 'CAMPAIGN_NOT_DRAFT') {
          toast.error(CAMPAIGN_NOT_DRAFT_MESSAGE);
        } else {
          // Any other refusal — `BUDGET_EXCEEDED` is the live one (AC-014),
          // and the server's own sentence is the authority, so it is shown
          // rather than a paraphrase that could drift from it. The fallback
          // only covers a response shaped unlike the error envelope.
          toast.error(
            data?.error?.message ?? 'Failed to add creator to campaign.'
          );
        }
        return;
      }

      toast.success('Creator added to campaign!');
      router.push(`/campaigns/${campaignId}`);
    } catch {
      toast.error('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col items-start gap-4 border-t border-border pt-8">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 w-full"
      >
        <label className="flex flex-col gap-1.5 text-sm flex-1 min-w-[200px]">
          <span className="font-medium">Select draft campaign</span>
          <select
            name="campaignId"
            required
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {campaigns.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm w-[120px]">
          <span className="font-medium">Videos</span>
          <input
            type="number"
            name="videoCount"
            min={1}
            defaultValue={1}
            required
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className={buttonVariants({ variant: 'default', size: 'default' })}
        >
          {loading ? 'Adding...' : ADD_TO_CAMPAIGN_LABEL}
        </button>
      </form>
    </section>
  );
}
