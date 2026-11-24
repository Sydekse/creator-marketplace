import type { ReachVideo } from './reach-bubbles';

interface CampaignStats {
  name: string;
  index: number;
  total: number;
  measured: number;
  views: number;
}

export function summarizeReachVideos(videos: ReachVideo[]) {
  const campaigns = new Map<string, CampaignStats>();
  let measured = 0;
  let views = 0;
  let maxViews = 19000;

  for (const video of videos) {
    let campaign = campaigns.get(video.campaignId);
    if (!campaign) {
      campaign = {
        name: video.campaignName,
        index: campaigns.size,
        total: 0,
        measured: 0,
        views: 0,
      };
      campaigns.set(video.campaignId, campaign);
    }
    campaign.total += 1;
    if (video.views !== null) {
      campaign.measured += 1;
      campaign.views += video.views;
      measured += 1;
      views += video.views;
      maxViews = Math.max(maxViews, video.views);
    }
  }

  return {
    campaigns,
    globalAvg: measured > 0 ? views / measured : 1000,
    maxViews,
  };
}

/**
 * Yield after a 6ms slice without changing tick order or exposing partial layouts.
 * A single tick cannot be preempted; inexpensive swarms still finish synchronously.
 */
export function settleReachSimulation(
  simulation: { tick: () => unknown; stop: () => unknown },
  onSettled: () => void
) {
  let remaining = 260;
  let frame: number | undefined;
  let cancelled = false;

  const advance = () => {
    if (cancelled) return;
    const start = performance.now();
    do {
      simulation.tick();
      remaining -= 1;
    } while (remaining > 0 && performance.now() - start < 6);

    if (remaining > 0) {
      frame = requestAnimationFrame(advance);
    } else {
      frame = undefined;
      onSettled();
    }
  };

  advance();
  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    simulation.stop();
  };
}
