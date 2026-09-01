import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AVATAR_BYTES,
  isBlobUrl,
  storeAvatarFromUrl,
} from '../lib/avatars/store-avatar';
import type { StoreAvatarDeps } from '../lib/avatars/store-avatar';

/**
 * Durable avatar storage (KAN-39 phase 4).
 *
 * The two contracts under test:
 *
 *   1. **Best-effort, always.** Every failure — no token, dead URL, wrong
 *      content type, oversized body, blob outage — resolves to null. Nothing
 *      here may ever throw into a sign-up or a stats refresh.
 *   2. **New blob first, old blob after.** `user.image` points at the new URL
 *      before the previous blob is deleted, so no interleaving leaves the row
 *      referencing a deleted object.
 */

const USER_ID = 'u0000000-0000-4000-8000-000000000001';
const SOURCE = 'https://p16.tiktokcdn.com/avatar.jpeg?x-expires=99';
const BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/avatars/u1/avatar-x.jpg';

function imageResponse(over: {
  ok?: boolean;
  contentType?: string | null;
  bytes?: number;
}): Response {
  const { ok = true, contentType = 'image/jpeg', bytes = 1024 } = over;
  return {
    ok,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response;
}

function makeDeps(over: Partial<StoreAvatarDeps> = {}) {
  const deps: StoreAvatarDeps = {
    fetchImage: vi.fn(async () => imageResponse({})),
    putBlob: vi.fn(async () => ({ url: BLOB_URL }) as never),
    deleteBlob: vi.fn(async () => undefined),
    loadCurrentImage: vi.fn(async () => null),
    saveImage: vi.fn(async () => undefined),
    hasToken: () => true,
    ...over,
  };
  return deps;
}

describe('isBlobUrl', () => {
  it('recognises our blob host and nothing else', () => {
    expect(isBlobUrl(BLOB_URL)).toBe(true);
    expect(isBlobUrl(SOURCE)).toBe(false);
    // A hostname merely containing the suffix mid-string is not ours.
    expect(isBlobUrl('https://blob.vercel-storage.com.evil.example/x')).toBe(
      false
    );
  });

  it('treats an unparseable string as not ours rather than throwing', () => {
    expect(isBlobUrl('not a url')).toBe(false);
    expect(isBlobUrl('')).toBe(false);
  });
});

describe('storeAvatarFromUrl', () => {
  it('copies the image, saves the new URL, and returns it', async () => {
    const deps = makeDeps();

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBe(
      BLOB_URL
    );

    expect(deps.putBlob).toHaveBeenCalledWith(
      `avatars/${USER_ID}/avatar.jpg`,
      expect.any(ArrayBuffer),
      expect.objectContaining({
        access: 'public',
        contentType: 'image/jpeg',
        // A fresh pathname per store — overwriting in place would hide the
        // new picture behind the CDN's cache of the old URL.
        addRandomSuffix: true,
      })
    );
    expect(deps.saveImage).toHaveBeenCalledWith(USER_ID, BLOB_URL);
  });

  it('no-ops without a blob token — local dev and CI stay silent', async () => {
    const deps = makeDeps({ hasToken: () => false });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBeNull();
    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.saveImage).not.toHaveBeenCalled();
  });

  it('refuses to copy a URL that is already ours', async () => {
    // Re-copying our own blob would churn storage for the same pixels.
    const deps = makeDeps();

    await expect(
      storeAvatarFromUrl(USER_ID, BLOB_URL, deps)
    ).resolves.toBeNull();
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed response', { ok: false }],
    ['a non-image content type', { contentType: 'text/html' }],
    ['a missing content type', { contentType: null }],
    ['an empty body', { bytes: 0 }],
    ['an oversized body', { bytes: MAX_AVATAR_BYTES + 1 }],
  ])('returns null for %s without writing anything', async (_label, over) => {
    const deps = makeDeps({
      fetchImage: vi.fn(async () => imageResponse(over)),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBeNull();
    expect(deps.putBlob).not.toHaveBeenCalled();
    expect(deps.saveImage).not.toHaveBeenCalled();
  });

  it('returns null when the source fetch rejects (network down)', async () => {
    const deps = makeDeps({
      fetchImage: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBeNull();
  });

  it('returns null when the blob upload itself fails', async () => {
    const deps = makeDeps({
      putBlob: vi.fn(async () => {
        throw new Error('blob outage');
      }),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBeNull();
    expect(deps.saveImage).not.toHaveBeenCalled();
  });

  it('deletes the previous blob after the row points at the new one', async () => {
    const previous =
      'https://abc123.public.blob.vercel-storage.com/avatars/u1/avatar-old.jpg';
    const order: string[] = [];
    const deps = makeDeps({
      loadCurrentImage: vi.fn(async () => previous),
      saveImage: vi.fn(async () => {
        order.push('save');
      }),
      deleteBlob: vi.fn(async () => {
        order.push('delete');
      }),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBe(
      BLOB_URL
    );
    expect(deps.deleteBlob).toHaveBeenCalledWith(previous);
    // Save first: a crash between the two leaves a working avatar plus one
    // orphan blob, never a row pointing at a deleted object.
    expect(order).toEqual(['save', 'delete']);
  });

  it('leaves a foreign previous URL alone — only our blobs are deletable', async () => {
    // The interim state after sign-up: user.image still holds the raw TikTok
    // CDN URL. There is nothing of ours to reclaim.
    const deps = makeDeps({
      loadCurrentImage: vi.fn(async () => SOURCE),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE_OTHER, deps)).resolves.toBe(
      BLOB_URL
    );
    expect(deps.deleteBlob).not.toHaveBeenCalled();
  });

  it('still succeeds when deleting the previous blob fails', async () => {
    const previous =
      'https://abc123.public.blob.vercel-storage.com/avatars/u1/avatar-old.jpg';
    const deps = makeDeps({
      loadCurrentImage: vi.fn(async () => previous),
      deleteBlob: vi.fn(async () => {
        throw new Error('gone already');
      }),
    });

    await expect(storeAvatarFromUrl(USER_ID, SOURCE, deps)).resolves.toBe(
      BLOB_URL
    );
    expect(deps.saveImage).toHaveBeenCalledWith(USER_ID, BLOB_URL);
  });

  it('maps each image content type onto its extension', async () => {
    const deps = makeDeps({
      fetchImage: vi.fn(async () =>
        imageResponse({ contentType: 'image/webp' })
      ),
    });

    await storeAvatarFromUrl(USER_ID, SOURCE, deps);

    expect(deps.putBlob).toHaveBeenCalledWith(
      `avatars/${USER_ID}/avatar.webp`,
      expect.anything(),
      expect.objectContaining({ contentType: 'image/webp' })
    );
  });
});

/** A second foreign source, distinct from the previous-image fixture. */
const SOURCE_OTHER = 'https://p16.tiktokcdn.com/avatar-2.jpeg?x-expires=99';
