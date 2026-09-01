import { del, put } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/auth-schema';

/**
 * Durable avatar storage (KAN-39 phase 4).
 *
 * TikTok's `avatar_url` is a signed CDN link that expires roughly 24–48 hours
 * after it is minted (`x-expires` query param), so the URL Better Auth writes
 * into `user.image` at sign-up goes dark within two days. This module copies
 * the image bytes into the project's Vercel Blob store and points `user.image`
 * at the permanent blob URL instead.
 *
 * Two callers, both best-effort by design:
 *
 *   - the `user.create.after` hook in `lib/auth.ts` (fresh sign-up), and
 *   - `refreshCreatorStats` (manual button + weekly cron), which re-copies the
 *     current picture so a creator who changes their TikTok avatar converges.
 *
 * Every failure path returns null rather than throwing: a missing blob token
 * (local dev, CI), a dead source URL, a non-image response, an oversized file,
 * a blob outage — none of these may fail a sign-up or a stats refresh. The UI
 * renders initials when `user.image` is null or the stored URL no longer
 * loads, so degradation is silent.
 *
 * Each store writes a *new* pathname (random suffix) and deletes the previous
 * blob afterwards, so a refreshed picture is never hidden behind a stale CDN
 * cache of an overwritten URL.
 */

/** Refuse to copy anything larger than this — avatars are ~50 KB. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Blob URLs are ours; anything else (tiktokcdn, …) is a foreign source. */
export function isBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Seams for tests; every default is the real thing. */
export interface StoreAvatarDeps {
  fetchImage: typeof fetch;
  putBlob: typeof put;
  deleteBlob: typeof del;
  loadCurrentImage: (userId: string) => Promise<string | null>;
  saveImage: (userId: string, url: string) => Promise<void>;
  /** Presence gate — without a token the module is a silent no-op. */
  hasToken: () => boolean;
}

const defaultDeps: StoreAvatarDeps = {
  fetchImage: fetch,
  putBlob: put,
  deleteBlob: del,
  loadCurrentImage: async (userId) => {
    const rows = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return rows[0]?.image ?? null;
  },
  saveImage: async (userId, url) => {
    await db.update(user).set({ image: url }).where(eq(user.id, userId));
  },
  hasToken: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
};

/**
 * Copies the image at `sourceUrl` into the blob store and points
 * `user.image` at it. Returns the new blob URL, or null when anything at all
 * prevented that — the caller must treat null as "no avatar this time", never
 * as an error to surface.
 *
 * The previous blob (if `user.image` was already ours) is deleted only after
 * the user row points at the new one, so a crash between the two writes leaves
 * a working avatar plus one orphan — never a dangling reference.
 */
export async function storeAvatarFromUrl(
  userId: string,
  sourceUrl: string,
  deps?: Partial<StoreAvatarDeps>
): Promise<string | null> {
  const d = { ...defaultDeps, ...deps };
  if (!d.hasToken()) return null;
  // Copying our own blob onto itself would only churn storage.
  if (isBlobUrl(sourceUrl)) return null;

  try {
    const res = await d.fetchImage(sourceUrl, { cache: 'no-store' });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim();
    const extension = contentType
      ? EXTENSION_BY_CONTENT_TYPE[contentType]
      : undefined;
    // Unknown or non-image content type: refuse rather than store bytes the
    // <img> tag may not render (and TikTok always serves one of the above).
    if (!contentType || !extension) return null;

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
      return null;
    }

    const previous = await d.loadCurrentImage(userId);

    const blob = await d.putBlob(
      `avatars/${userId}/avatar.${extension}`,
      bytes,
      {
        access: 'public',
        contentType,
        // A fresh URL per store — the delete below is what reclaims space.
        addRandomSuffix: true,
      }
    );

    await d.saveImage(userId, blob.url);

    // Best-effort cleanup; an orphan blob is invisible and cheap.
    if (previous && isBlobUrl(previous) && previous !== blob.url) {
      try {
        await d.deleteBlob(previous);
      } catch {
        // ignore — next successful store retries against the new previous.
      }
    }

    return blob.url;
  } catch {
    return null;
  }
}
