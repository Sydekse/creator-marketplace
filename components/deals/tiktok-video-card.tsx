'use client';

import { useState } from 'react';
import { ArrowSquareOut, Play } from '@phosphor-icons/react/dist/ssr';
import { cn, textLinkFeedback } from '@/lib/utils';

/**
 * The submitted-video card, shared by the creator's deal page and the brand's
 * review page — "Video 2" must look the same on both sides of a rejection.
 *
 * Three states, degrading in order:
 *
 *   1. **Thumbnail + in-app playback** — the stored blob snapshot fills the
 *      9:16 frame; clicking it swaps in TikTok's own player
 *      (`tiktok.com/embed/v2/{videoId}`), loaded only on that click so no
 *      TikTok script runs until a person asks for the video.
 *   2. **No thumbnail** — the placeholder frame the landing mockup
 *      established (neutral field, play badge); playback still works when the
 *      video id resolved.
 *   3. **No video id** — the frame is a plain link to the post on TikTok, the
 *      same deliberate new-tab open the raw link used to be.
 *
 * The security stance of the brand page holds: nothing here ever fetches the
 * submitted URL. The image is our own blob; the iframe src is built from a
 * numeric id on a TikTok host we chose; the submitted URL appears only as the
 * `href` of an explicit external link, opened in a new tab with `rel` set.
 */

export const VIEW_ON_TIKTOK_LABEL = 'View on TikTok';

/** TikTok's v2 player wants ~325px of width to lay out its controls. */
const PLAYER_WIDTH_CLASS = 'w-full max-w-[325px]';

export interface TiktokVideoCardProps {
  tiktokUrl: string;
  thumbnailUrl: string | null;
  tiktokVideoId: string | null;
  /** Accessible name for the frame — "Video 1", from `videoHeading`. */
  videoLabel: string;
}

export function TiktokVideoCard({
  tiktokUrl,
  thumbnailUrl,
  tiktokVideoId,
  videoLabel,
}: TiktokVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  const playBadge = (
    <span className="bd-dlplay">
      <Play size={12} weight="fill" className="text-neutral-50" aria-hidden />
    </span>
  );

  const frameContent = thumbnailUrl ? (
    <>
      {/* Our blob snapshot, never a TikTok CDN URL: those expire, and
          next/image would need a remotePatterns entry for a host whose whole
          point is that we copied the bytes off it (same call as
          initials-avatar). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl}
        alt={`Cover of ${videoLabel}`}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="absolute inset-0 grid place-items-center bg-neutral-950/20">
        {playBadge}
      </span>
    </>
  ) : (
    // The placeholder frame the landing mockup established — same shape as a
    // real cover, so a failed thumbnail copy degrades quietly.
    <span className="absolute inset-0 grid place-items-center bg-neutral-100">
      {playBadge}
    </span>
  );

  const frameClass = cn(
    'bd-dlthumb group',
    playing ? `bd-tiktokframe--playing ${PLAYER_WIDTH_CLASS}` : 'w-24 sm:w-28'
  );

  return (
    <div className="flex shrink-0 flex-col items-start gap-2">
      {playing && tiktokVideoId ? (
        <div className={frameClass}>
          <iframe
            // The id is numeric and the host is ours to choose: the submitted
            // URL never reaches this attribute.
            src={`https://www.tiktok.com/embed/v2/${tiktokVideoId}`}
            title={videoLabel}
            allow="encrypted-media; fullscreen; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      ) : tiktokVideoId ? (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${videoLabel}`}
          className={frameClass}
        >
          {frameContent}
        </button>
      ) : (
        // No id resolved (a vm. share link oEmbed could not expand): the frame
        // is the same deliberate external open the raw link used to be.
        <a
          href={tiktokUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`Open ${videoLabel} on TikTok`}
          className={frameClass}
        >
          {frameContent}
        </a>
      )}
      <a
        href={tiktokUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={cn(
          'bd-vplink inline-flex items-center gap-1 text-xs',
          textLinkFeedback
        )}
      >
        <ArrowSquareOut size={12} aria-hidden />
        {VIEW_ON_TIKTOK_LABEL}
      </a>
    </div>
  );
}
