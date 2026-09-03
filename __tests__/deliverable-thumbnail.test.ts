import { describe, expect, it, vi } from 'vitest';
import {
  MAX_THUMBNAIL_BYTES,
  TIKTOK_OEMBED_ENDPOINT,
  parseTiktokVideoId,
  storeDeliverableThumbnail,
} from '@/lib/deliverables/thumbnail';
import type { StoreThumbnailDeps } from '@/lib/deliverables/thumbnail';

/**
 * The deliverable thumbnail store (deliverable video cards).
 *
 * Everything here goes through the deps seam — no network, no blob store, no
 * database. The contract under test is the same one `store-avatar` set: a
 * best-effort module whose every failure path degrades to nulls, because a
 * thumbnail must never fail a submission.
 */

const DELIVERABLE_ID = '7b1a1c1e-0000-4000-8000-000000000001';
const LONG_URL = 'https://www.tiktok.com/@selam/video/7301234567890123456';
const SHORT_URL = 'https://vm.tiktok.com/ZMabc123/';
const CDN_THUMB =
  'https://p16-sign.tiktokcdn-us.com/obj/cover.jpeg?x-expires=1';
const BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/deliverable-thumbs/x/thumb-r4nd.jpg';
const OLD_BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/deliverable-thumbs/x/thumb-old1.jpg';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imageResponse(
  bytes: number,
  contentType = 'image/jpeg',
  status = 200
): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': contentType },
  });
}

/**
 * A deps set where everything works: oEmbed answers with a thumbnail and a
 * video id, the image downloads, the blob stores, the row saves. Tests break
 * exactly one thing each.
 */
function okDeps(over: Partial<StoreThumbnailDeps> = {}): {
  deps: StoreThumbnailDeps;
  fetched: string[];
  saved: Array<Record<string, unknown>>;
  put: string[];
  deleted: string[];
} {
  const fetched: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const put: string[] = [];
  const deleted: string[] = [];

  const deps: StoreThumbnailDeps = {
    fetchFn: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith(TIKTOK_OEMBED_ENDPOINT)) {
        return jsonResponse({
          thumbnail_url: CDN_THUMB,
          embed_product_id: '7301234567890123456',
        });
      }
      return imageResponse(50_000);
    }) as unknown as typeof fetch,
    putBlob: vi.fn(async (pathname: string) => {
      put.push(pathname);
      return { url: BLOB_URL } as Awaited<
        ReturnType<StoreThumbnailDeps['putBlob']>
      >;
    }) as unknown as StoreThumbnailDeps['putBlob'],
    deleteBlob: vi.fn(async (url: string | string[]) => {
      deleted.push(String(url));
    }) as unknown as StoreThumbnailDeps['deleteBlob'],
    loadCurrent: async () => ({ thumbnailUrl: null }),
    save: async (_id, fields) => {
      saved.push(fields);
    },
    hasToken: () => true,
    ...over,
  };

  return { deps, fetched, saved, put, deleted };
}

describe('parseTiktokVideoId', () => {
  it('reads the id out of a long-form URL, on any accepted host', () => {
    expect(parseTiktokVideoId(LONG_URL)).toBe('7301234567890123456');
    expect(parseTiktokVideoId('http://m.tiktok.com/@a.b-c/video/42')).toBe(
      '42'
    );
    expect(parseTiktokVideoId('tiktok.com/@x/video/7?is_from_webapp=1')).toBe(
      '7'
    );
  });

  it('answers null for share links — a code is not a video id', () => {
    expect(parseTiktokVideoId(SHORT_URL)).toBeNull();
  });
});

describe('storeDeliverableThumbnail', () => {
  it('stores the blob URL and the video id when everything works', async () => {
    const { deps, fetched, saved, put } = okDeps();

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      LONG_URL,
      deps
    );

    expect(result).toEqual({
      thumbnailUrl: BLOB_URL,
      tiktokVideoId: '7301234567890123456',
    });
    // The oEmbed request carries the submitted URL only as an encoded query
    // parameter to TikTok's own endpoint — never as the fetched host.
    expect(fetched[0]).toBe(
      `${TIKTOK_OEMBED_ENDPOINT}?url=${encodeURIComponent(LONG_URL)}`
    );
    expect(fetched[1]).toBe(CDN_THUMB);
    expect(put[0]).toBe(`deliverable-thumbs/${DELIVERABLE_ID}/thumb.jpg`);
    expect(saved).toEqual([
      { thumbnailUrl: BLOB_URL, tiktokVideoId: '7301234567890123456' },
    ]);
  });

  it('resolves the video id for a vm. share link from the oEmbed response', async () => {
    const { deps } = okDeps();

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    // The URL itself carries no id; oEmbed's `embed_product_id` fills in.
    expect(result.tiktokVideoId).toBe('7301234567890123456');
  });

  it('falls back to the embed html when embed_product_id is absent', async () => {
    const { deps } = okDeps({
      fetchFn: (async () =>
        jsonResponse({
          html: '<blockquote class="tiktok-embed" data-video-id="99887766">…</blockquote>',
        })) as unknown as typeof fetch,
      hasToken: () => false,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    expect(result.tiktokVideoId).toBe('99887766');
  });

  it('prefers the id parsed from a long URL over the oEmbed answer', async () => {
    const { deps } = okDeps({
      fetchFn: (async (input: RequestInfo | URL) => {
        if (String(input).startsWith(TIKTOK_OEMBED_ENDPOINT)) {
          return jsonResponse({ embed_product_id: '111' });
        }
        return imageResponse(1000);
      }) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      LONG_URL,
      deps
    );

    // The submitted URL is the validated artefact; oEmbed only fills gaps.
    expect(result.tiktokVideoId).toBe('7301234567890123456');
  });

  it('still saves the video id when oEmbed is down, for a long URL', async () => {
    const { deps, saved } = okDeps({
      fetchFn: (async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      LONG_URL,
      deps
    );

    // In-app playback survives an oEmbed outage; only the thumbnail is lost.
    expect(result).toEqual({
      thumbnailUrl: null,
      tiktokVideoId: '7301234567890123456',
    });
    expect(saved).toEqual([{ tiktokVideoId: '7301234567890123456' }]);
  });

  it('answers all-null and writes nothing when oEmbed is down for a share link', async () => {
    const { deps, saved } = okDeps({
      fetchFn: (async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    expect(result).toEqual({ thumbnailUrl: null, tiktokVideoId: null });
    // Drizzle refuses `.set({})`; with nothing learned there is no update.
    expect(saved).toEqual([]);
  });

  it('skips the image copy without a blob token, but keeps the id', async () => {
    const { deps, fetched, saved } = okDeps({ hasToken: () => false });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      LONG_URL,
      deps
    );

    expect(result.thumbnailUrl).toBeNull();
    expect(result.tiktokVideoId).toBe('7301234567890123456');
    // Only the oEmbed request went out; the CDN image was never fetched.
    expect(fetched).toHaveLength(1);
    expect(saved).toEqual([{ tiktokVideoId: '7301234567890123456' }]);
  });

  it.each([
    ['a non-200 image response', imageResponse(1000, 'image/jpeg', 404)],
    ['a non-image content type', imageResponse(1000, 'text/html')],
    ['an empty body', imageResponse(0)],
    ['an oversized body', imageResponse(MAX_THUMBNAIL_BYTES + 1)],
  ])('refuses %s and stores no thumbnail', async (_label, response) => {
    const { deps, put } = okDeps({
      fetchFn: (async (input: RequestInfo | URL) => {
        if (String(input).startsWith(TIKTOK_OEMBED_ENDPOINT)) {
          return jsonResponse({
            thumbnail_url: CDN_THUMB,
            embed_product_id: '42',
          });
        }
        return response;
      }) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    expect(result.thumbnailUrl).toBeNull();
    expect(put).toEqual([]);
    // The id still landed — the two facts fail independently.
    expect(result.tiktokVideoId).toBe('42');
  });

  it('ignores a non-https thumbnail_url in the oEmbed response', async () => {
    const fetched: string[] = [];
    const { deps } = okDeps({
      fetchFn: (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return jsonResponse({
          thumbnail_url: 'http://169.254.169.254/latest/meta-data',
          embed_product_id: '42',
        });
      }) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    // The suspect URL is never fetched at all.
    expect(fetched).toHaveLength(1);
    expect(result.thumbnailUrl).toBeNull();
  });

  it('deletes the previous blob only after the row points at the new one', async () => {
    const order: string[] = [];
    const deletedUrls: string[] = [];
    const { deps } = okDeps({
      loadCurrent: async () => ({ thumbnailUrl: OLD_BLOB_URL }),
      save: async () => {
        order.push('save');
      },
      deleteBlob: (async (url: string) => {
        order.push('delete');
        deletedUrls.push(url);
      }) as unknown as StoreThumbnailDeps['deleteBlob'],
    });

    await storeDeliverableThumbnail(DELIVERABLE_ID, LONG_URL, deps);

    expect(deletedUrls).toEqual([OLD_BLOB_URL]);
    // A crash between the writes must leave an orphan, not a dangling row —
    // so the delete may not run before the save (KAN-39's ordering).
    expect(order.indexOf('save')).toBeLessThan(order.indexOf('delete'));
  });

  it('never deletes a previous URL that is not ours', async () => {
    const deletedUrls: string[] = [];
    const { deps } = okDeps({
      loadCurrent: async () => ({ thumbnailUrl: CDN_THUMB }),
      deleteBlob: (async (url: string) => {
        deletedUrls.push(url);
      }) as unknown as StoreThumbnailDeps['deleteBlob'],
    });

    await storeDeliverableThumbnail(DELIVERABLE_ID, LONG_URL, deps);

    expect(deletedUrls).toEqual([]);
  });

  it('survives a failing delete of the previous blob', async () => {
    const { deps } = okDeps({
      loadCurrent: async () => ({ thumbnailUrl: OLD_BLOB_URL }),
      deleteBlob: (async () => {
        throw new Error('blob outage');
      }) as unknown as StoreThumbnailDeps['deleteBlob'],
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      LONG_URL,
      deps
    );

    // The orphan is invisible and cheap; the new thumbnail still stands.
    expect(result.thumbnailUrl).toBe(BLOB_URL);
  });

  it('returns nulls instead of throwing when even the save fails', async () => {
    const { deps } = okDeps({
      save: async () => {
        throw new Error('db down');
      },
    });

    // The submission has already committed; nothing here may throw at it.
    await expect(
      storeDeliverableThumbnail(DELIVERABLE_ID, LONG_URL, deps)
    ).resolves.toBeDefined();
  });

  it.each([
    ['a non-200 oEmbed answer', jsonResponse({}, 403)],
    ['a non-object body', jsonResponse('nope')],
    ['a body with wrong-typed fields', jsonResponse({ thumbnail_url: 7 })],
  ])('degrades %s to nulls for a share link', async (_label, response) => {
    const { deps } = okDeps({
      fetchFn: (async () => response) as unknown as typeof fetch,
    });

    const result = await storeDeliverableThumbnail(
      DELIVERABLE_ID,
      SHORT_URL,
      deps
    );

    expect(result).toEqual({ thumbnailUrl: null, tiktokVideoId: null });
  });
});
