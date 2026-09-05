import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

describe('legacy deliverable migration adoption', () => {
  it('adopts only surviving facts as version zero, using timestamp then ID for stable order', async () => {
    const namespace = `legacy_${crypto.randomUUID().replaceAll('-', '')}`;
    class RollbackFixture extends Error {}
    try {
      await db.transaction(async (tx) => {
        // Transaction-local schema: the pre-migration tables never replace live tables.
        await tx.execute(
          sql.raw(`
          CREATE SCHEMA "${namespace}";
          SET LOCAL search_path TO "${namespace}";
          CREATE TABLE "user" (id uuid PRIMARY KEY);
          CREATE TABLE deliverable (
            id uuid PRIMARY KEY, deal_id uuid NOT NULL, tiktok_url text NOT NULL,
            submitted_at timestamptz NOT NULL, review_status text NOT NULL,
            reviewed_at timestamptz, rejection_reason text, thumbnail_url text, tiktok_video_id text
          );
          CREATE TABLE video_metric (
            id uuid PRIMARY KEY, deliverable_id uuid NOT NULL, views integer, likes integer,
            shares integer, comments integer, source text NOT NULL, last_updated_at timestamptz, stale boolean NOT NULL
          );
          INSERT INTO deliverable VALUES
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'https://www.tiktok.com/@legacy/video/2', '2026-08-01T12:00:00Z', 'rejected', '2026-08-02T12:00:00Z', 'Surviving note', 'old-cover', '2'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'https://www.tiktok.com/@legacy/video/1', '2026-08-01T12:00:00Z', 'approved', '2026-08-02T12:00:00Z', NULL, NULL, NULL);
          INSERT INTO video_metric VALUES (
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
            0, NULL, 2, 3, 'admin', '2026-08-03T12:00:00Z', false
          );
        `)
        );
        const migration = readFileSync(
          'drizzle/0018_kind_hemingway.sql',
          'utf8'
        ).replaceAll('"public".', `"${namespace}".`);
        await tx.execute(sql.raw(migration));
        const rows = (
          await tx.execute(
            sql`SELECT * FROM deliverable ORDER BY video_ordinal`
          )
        ).rows;
        expect(rows.map((row) => row.id)).toEqual([
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        ]);
        expect(
          rows.every(
            (row) =>
              row.submission_version === 0 &&
              row.history_completeness === 'legacy_baseline'
          )
        ).toBe(true);
        expect(rows[1]).toMatchObject({
          rejection_reason: 'Surviving note',
          thumbnail_url: 'old-cover',
          review_status: 'rejected',
        });
        const events = (
          await tx.execute(sql`SELECT * FROM deliverable_event ORDER BY seq`)
        ).rows;
        expect(events).toHaveLength(2);
        expect(
          events.every(
            (event) =>
              event.kind === 'legacy_baseline' &&
              event.actor_id === null &&
              event.actor_role === 'unknown'
          )
        ).toBe(true);
        expect(events[1]).toMatchObject({
          submission_version: 0,
          note: 'Surviving note',
          metadata: {
            reviewStatus: 'rejected',
            metrics: { views: 0, likes: null, source: 'admin' },
          },
        });
        expect(
          events.every(
            (event) =>
              new Date(String(event.occurred_at)).getTime() >
              new Date('2026-08-03').getTime()
          )
        ).toBe(true);
        expect(events[1].metadata).not.toHaveProperty('thumbnailUrl');
        throw new RollbackFixture();
      });
    } catch (error) {
      if (!(error instanceof RollbackFixture)) throw error;
    }
  });
});
