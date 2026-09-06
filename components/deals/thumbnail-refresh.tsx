'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scheduleThumbnailRefresh } from '@/lib/deliverables/thumbnail-refresh';

export function ThumbnailRefresh({
  latestPendingSubmission,
}: {
  latestPendingSubmission: number | null;
}) {
  const router = useRouter();

  useEffect(
    () =>
      scheduleThumbnailRefresh(latestPendingSubmission, () => router.refresh()),
    [latestPendingSubmission, router]
  );

  // Missing media remains playable via the existing placeholder/external link.
  // An ordinary page reload picks up enrichment after the bounded window.
  return null;
}
