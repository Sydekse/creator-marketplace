const REFRESH_OFFSETS_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000];

export function latestPendingThumbnailSubmission(
  videos: ReadonlyArray<{
    thumbnailUrl: string | null;
    tiktokVideoId: string | null;
    submittedAt: Date;
  }>
): number | null {
  let latest: number | null = null;
  for (const video of videos) {
    if (video.thumbnailUrl && video.tiktokVideoId) continue;
    const submittedAt = video.submittedAt.getTime();
    if (
      Number.isFinite(submittedAt) &&
      (latest === null || submittedAt > latest)
    ) {
      latest = submittedAt;
    }
  }
  return latest;
}

/** Absolute submission age keeps RSC refreshes/remounts from restarting polling. */
export function scheduleThumbnailRefresh(
  submittedAt: number | null,
  refresh: () => void
): () => void {
  if (submittedAt === null || !Number.isFinite(submittedAt)) return () => {};
  const now = Date.now();
  if (submittedAt > now) return () => {};
  const timers = REFRESH_OFFSETS_MS.map((offset) => submittedAt + offset - now)
    .filter((delay) => delay > 0)
    .map((delay) => setTimeout(refresh, delay));
  return () => timers.forEach(clearTimeout);
}
