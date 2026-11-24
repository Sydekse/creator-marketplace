import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThumbnailRefresh } from '@/components/deals/thumbnail-refresh';
import { TiktokVideoCard } from '@/components/deals/tiktok-video-card';

vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('thumbnail progressive enrichment UI', () => {
  it('renders a usable placeholder immediately and the stored image on the next read', () => {
    const props = {
      tiktokUrl: 'https://vm.tiktok.com/test/',
      thumbnailUrl: null,
      tiktokVideoId: null,
      videoLabel: 'Video 1',
    };
    const pending = renderToStaticMarkup(<TiktokVideoCard {...props} />);
    expect(pending).toContain('bg-neutral-100');
    expect(pending).toContain('Open Video 1 on TikTok');
    expect(pending).not.toContain('<iframe');
    expect(pending).not.toContain('<img');
    const enriched = renderToStaticMarkup(
      <TiktokVideoCard
        {...props}
        thumbnailUrl="https://blob.example/cover.jpg"
        tiktokVideoId="123"
      />
    );
    expect(enriched).toContain('src="https://blob.example/cover.jpg"');
    expect(enriched).toContain('Play Video 1');
    expect(enriched).not.toContain('<iframe');
  });

  it('preserves the existing appearance while media is pending or unavailable', () => {
    const html = renderToStaticMarkup(
      <ThumbnailRefresh latestPendingSubmission={0} />
    );
    expect(html).toBe('');
  });

  it('renders no refresh control once all media has arrived', () => {
    expect(
      renderToStaticMarkup(<ThumbnailRefresh latestPendingSubmission={null} />)
    ).toBe('');
  });
});
