import { del, put } from '@vercel/blob';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { deliverable } from '@/db/schema';
import { isBlobUrl } from '@/lib/avatars/store-avatar';

/**
 * Durable deliverable thumbnails (deliverable video cards).
 *
 * A submitted deliverable used to render as its raw TikTok URL. The card that
 * replaces it needs two things this module captures once, at submit:
 *
 *   - **the cover image**, copied into our Vercel Blob store. TikTok's oEmbed
 *     `thumbnail_url` is a signed CDN link that expires (same failure mode as
 *     avatars, KAN-39), so it cannot be stored or hotlinked as-is. The copy is
 *     also the permanent record: a video that is later deleted or made private
 *     still shows what was submitted.
 *   - **the numeric video id**, which the in-app player
 *     (`tiktok.com/embed/v2/{id}`) requires. Long-form URLs carry it in the
 *     path; `vm.tiktok.com` share links do not, and only oEmbed can resolve
 *     those without following the redirect ourselves.
 *
 * Both come from one unauthenticated request to `www.tiktok.com/oembed` — a
 * TikTok host we choose, never the submitted URL itself, which stays
 * unfetched by every page (Tech Spec §6.3). The submitted URL appears only as
 * a query *parameter* to TikTok's own endpoint, and it has already passed
 * `TIKTOK_VIDEO_URL_PATTERN`'s host allowlist before this module sees it.
 *
 * Best-effort throughout, exactly like `store-avatar`: every failure path
 * returns partial or null results rather than throwing, because a thumbnail
 * must never fail a submission. The card falls back to the placeholder frame
 * (no thumbnail) and to opening TikTok (no video id).
 */

/** Refuse to copy anything larger than this — TikTok covers are ~30–100 KB. */
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/** TikTok's oEmbed endpoint — ours to choose, never the submitted host. */
export const TIKTOK_OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/**
 * The video id straight out of a long-form URL, or null for share links.
 *
 * The pattern mirrors the `@handle/video/{id}` alternative of
 * `TIKTOK_VIDEO_URL_PATTERN`; `vm.tiktok.com/{code}` codes are not video ids
 * and are deliberately not matched. Exported so the card's server-side callers
 * can derive an id for rows submitted before this module existed.
 */
export function parseTiktokVideoId(tiktokUrl: string): string | null {
  const match = /tiktok\.com\/@[\w.-]+\/video\/(\d+)/i.exec(tiktokUrl);
  return match ? match[1] : null;
}

/** The two facts oEmbed contributes; either may be independently absent. */
interface OembedFacts {
  thumbnailUrl: string | null;
  videoId: string | null;
}

/** Seams for tests; every default is the real thing. */
export interface StoreThumbnailDeps {
  /** Both the oEmbed JSON request and the image download go through this. */
  fetchFn: typeof fetch;
  putBlob: typeof put;
  deleteBlob: typeof del;
  isReferenced: (url: string) => Promise<boolean>;
  loadCurrent: (deliverableId: string) => Promise<{
    thumbnailUrl: string | null;
    submissionVersion?: number;
  } | null>;
  save: (
    deliverableId: string,
    fields: { thumbnailUrl?: string | null; tiktokVideoId?: string | null },
    expectedVersion?: number,
    previous?: string | null
  ) => Promise<boolean | void>;
  /** Presence gate — without a blob token the image copy is skipped. */
  hasToken: () => boolean;
}

const defaultDeps: StoreThumbnailDeps = {
  fetchFn: fetch,
  putBlob: put,
  deleteBlob: del,
  isReferenced: async (url) => {
    const rows = await db
      .select({ id: deliverable.id })
      .from(deliverable)
      .where(eq(deliverable.thumbnailUrl, url))
      .limit(1);
    return rows.length > 0;
  },
  loadCurrent: async (deliverableId) => {
    const rows = await db
      .select({
        thumbnailUrl: deliverable.thumbnailUrl,
        submissionVersion: deliverable.submissionVersion,
      })
      .from(deliverable)
      .where(eq(deliverable.id, deliverableId))
      .limit(1);
    return rows[0] ?? null;
  },
  save: async (deliverableId, fields, expectedVersion, previous) => {
    if (expectedVersion === undefined) return false;
    const saved = await db
      .update(deliverable)
      .set(fields)
      .where(
        and(
          eq(deliverable.id, deliverableId),
          eq(deliverable.submissionVersion, expectedVersion),
          previous
            ? eq(deliverable.thumbnailUrl, previous)
            : isNull(deliverable.thumbnailUrl)
        )
      )
      .returning({ id: deliverable.id });
    return saved.length === 1;
  },
  hasToken: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
};

/**
 * One oEmbed round trip, reduced to the two facts the card needs.
 *
 * `embed_product_id` is TikTok's name for the video id in oEmbed responses;
 * the `html` fallback covers responses where it is absent but the blockquote
 * embed still carries `data-video-id`. Anything unexpected — non-200, non-JSON,
 * missing fields — degrades to nulls, never an exception.
 */
async function fetchOembedFacts(
  tiktokUrl: string,
  fetchFn: typeof fetch
): Promise<OembedFacts> {
  try {
    const res = await fetchFn(
      `${TIKTOK_OEMBED_ENDPOINT}?url=${encodeURIComponent(tiktokUrl)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return { thumbnailUrl: null, videoId: null };

    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) {
      return { thumbnailUrl: null, videoId: null };
    }
    const record = body as Record<string, unknown>;

    const thumbnailUrl =
      typeof record.thumbnail_url === 'string' &&
      /^https:\/\//.test(record.thumbnail_url)
        ? record.thumbnail_url
        : null;

    let videoId: string | null = null;
    if (
      typeof record.embed_product_id === 'string' &&
      /^\d+$/.test(record.embed_product_id)
    ) {
      videoId = record.embed_product_id;
    } else if (typeof record.html === 'string') {
      const match = /data-video-id="(\d+)"/.exec(record.html);
      videoId = match ? match[1] : null;
    }

    return { thumbnailUrl, videoId };
  } catch {
    return { thumbnailUrl: null, videoId: null };
  }
}

/**
 * Copies the cover image at `sourceUrl` into the blob store. Returns the blob
 * URL, or null when anything at all prevented that. Same refusals as
 * `storeAvatarFromUrl`: non-image or unknown content type, empty or oversized
 * body, any network or blob failure.
 */
async function copyImageToBlob(
  deliverableId: string,
  sourceUrl: string,
  d: StoreThumbnailDeps
): Promise<string | null> {
  try {
    const res = await d.fetchFn(sourceUrl, { cache: 'no-store' });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim();
    const extension = contentType
      ? EXTENSION_BY_CONTENT_TYPE[contentType]
      : undefined;
    if (!contentType || !extension) return null;

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      return null;
    }

    const blob = await d.putBlob(
      `deliverable-thumbs/${deliverableId}/thumb.${extension}`,
      bytes,
      {
        access: 'public',
        contentType,
        // A fresh URL per store — the delete in the caller reclaims space.
        addRandomSuffix: true,
      }
    );
    return blob.url;
  } catch {
    return null;
  }
}

export interface StoreThumbnailResult {
  thumbnailUrl: string | null;
  tiktokVideoId: string | null;
}

/**
 * Resolves and persists the thumbnail and video id for one deliverable.
 *
 * Runs after the submission transaction has committed (the row must exist to
 * be updated), awaited but failure-tolerant: the caller ignores the result.
 * Each fact is saved independently — an oEmbed response with a video id but a
 * dead image URL still stores the id, so in-app playback works even when the
 * thumbnail fell through.
 *
 * Replacement clears old media in the submission transaction. This function
 * can only attach results to the expected version and prior thumbnail state.
 * Unreferenced blobs are reclaimed after the current pointer has changed;
 * history retains URLs and text, not deleted thumbnail references.
 */
export async function storeDeliverableThumbnail(
  deliverableId: string,
  tiktokUrl: string,
  deps?: Partial<StoreThumbnailDeps>,
  expectedVersion?: number,
  supersededThumbnail?: string | null
): Promise<StoreThumbnailResult> {
  const d = { ...defaultDeps, ...deps };
  const result: StoreThumbnailResult = {
    thumbnailUrl: null,
    tiktokVideoId: null,
  };
  let ownedBlob: string | null = null;
  let attached = false;
  const cleanup = async (url: string | null | undefined) => {
    if (url && isBlobUrl(url)) {
      try {
        if (!(await d.isReferenced(url))) await d.deleteBlob(url);
      } catch {
        /* Never delete when reference ownership is uncertain. */
      }
    }
  };

  try {
    await cleanup(supersededThumbnail);
    const current = await d.loadCurrent(deliverableId);
    if (!current || current.submissionVersion !== expectedVersion)
      return result;
    const facts = await fetchOembedFacts(tiktokUrl, d.fetchFn);
    // The long-form URL is authoritative when it carries the id; oEmbed fills
    // in for vm. share links, which carry none.
    result.tiktokVideoId = parseTiktokVideoId(tiktokUrl) ?? facts.videoId;

    const previous = current.thumbnailUrl;
    if (facts.thumbnailUrl && d.hasToken()) {
      result.thumbnailUrl = await copyImageToBlob(
        deliverableId,
        facts.thumbnailUrl,
        d
      );
      ownedBlob = result.thumbnailUrl;
    }

    const fields = {
      // Only preserve fields from this same submission version.
      ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
      ...(result.tiktokVideoId ? { tiktokVideoId: result.tiktokVideoId } : {}),
    };
    // Drizzle refuses an empty `.set({})`, and there is nothing to write.
    if (Object.keys(fields).length > 0) {
      const saved = await d.save(
        deliverableId,
        fields,
        expectedVersion,
        previous
      );
      if (saved === false) {
        await cleanup(ownedBlob);
        ownedBlob = null;
        return { thumbnailUrl: null, tiktokVideoId: null };
      }
      attached = true;
    }

    // Cleanup of the blob a resubmission replaces, only *after* the row points
    // at the new one — a crash between the writes leaves a working thumbnail
    // plus one orphan, never a dangling reference. Best-effort: an orphan is
    // invisible and cheap, a dangling reference is a broken image.
    if (
      result.thumbnailUrl &&
      previous &&
      isBlobUrl(previous) &&
      previous !== result.thumbnailUrl
    ) {
      await cleanup(previous);
    }
  } catch {
    // Best-effort by contract: a thumbnail must never fail a submission.
    if (!attached) await cleanup(ownedBlob);
    return { thumbnailUrl: null, tiktokVideoId: null };
  }

  return result;
}
