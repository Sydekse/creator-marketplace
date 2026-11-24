import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The submitted-video card (deliverable video cards).
 *
 * A deliverable used to render as its raw TikTok URL on both deal pages. This
 * suite pins the card that replaced it and the security stance it inherits
 * from the brand review page (Tech Spec §6.3): nothing may fetch the
 * submitted URL — the thumbnail is our own blob snapshot, the player iframe
 * src is built from a numeric video id on a TikTok host we chose, and the
 * submitted URL survives only as the href of a deliberate external open.
 */

const CARD = readFileSync('components/deals/tiktok-video-card.tsx', 'utf8');
const CREATOR_PAGE = readFileSync(
  'app/(creator)/creator/deals/[id]/page.tsx',
  'utf8'
);
const BRAND_PAGE = readFileSync(
  'app/(brand)/(onboarded)/deals/[id]/page.tsx',
  'utf8'
);

describe('the card never touches the submitted URL except as a link', () => {
  it('builds the iframe src from the numeric id, on a host we chose', () => {
    // The one embed URL, assembled from `tiktokVideoId` — the submitted URL
    // cannot reach the iframe.
    expect(CARD).toContain(
      'src={`https://www.tiktok.com/embed/v2/${tiktokVideoId}`}'
    );
    expect(CARD).not.toContain('src={tiktokUrl}');
  });

  it('sandboxes the player', () => {
    expect(CARD).toMatch(/sandbox="[^"]*allow-scripts/);
  });

  it('opens the submitted URL only deliberately, in a new tab, with rel set', () => {
    // The same discipline the raw link had — every anchor whose href is the
    // submitted URL carries the full rel and a new tab.
    const anchors = CARD.match(/href=\{tiktokUrl\}/g) ?? [];
    const rels = CARD.match(/rel="noopener noreferrer nofollow"/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    expect(rels.length).toBe(anchors.length);
    expect(CARD).not.toMatch(/fetch\(/);
  });

  it('renders the thumbnail from the stored blob URL, never a TikTok CDN link', () => {
    expect(CARD).toContain('src={thumbnailUrl}');
    expect(CARD).not.toContain('tiktokcdn');
  });
});

describe('the card degrades in order', () => {
  it('loads the player only on click — no TikTok script until asked', () => {
    // `playing` starts false and only the button flips it, so a page full of
    // cards makes zero TikTok requests until a person presses play.
    expect(CARD).toContain('useState(false)');
    expect(CARD).toContain('onClick={() => setPlaying(true)}');
    expect(CARD).toMatch(/playing && tiktokVideoId \?/);
  });

  it('falls back to the placeholder frame without a thumbnail', () => {
    // The neutral field + play badge the landing mockup established — a failed
    // thumbnail copy must look designed, not broken.
    expect(CARD).toMatch(/thumbnailUrl \? \(/);
    expect(CARD).toContain('bg-neutral-100');
  });

  it('falls back to opening TikTok when no video id resolved', () => {
    // A vm. share link whose oEmbed lookup failed has no id to play with; the
    // frame is then exactly the deliberate external open the raw link was.
    expect(CARD).toMatch(/aria-label=\{`Open \$\{videoLabel\} on TikTok`\}/);
  });

  it('always offers the external view, whatever else worked', () => {
    expect(CARD).toContain('VIEW_ON_TIKTOK_LABEL');
  });
});

describe('both deal pages render the card instead of the raw URL', () => {
  it.each([
    ['creator', CREATOR_PAGE],
    ['brand', BRAND_PAGE],
  ])('the %s page mounts the card inside the video loop', (_side, page) => {
    const loop = page.slice(page.indexOf('deal.deliverables.map('));
    expect(loop).toContain('<TiktokVideoCard');
    expect(loop).toContain('thumbnailUrl={video.thumbnailUrl}');
  });

  it.each([
    ['creator', CREATOR_PAGE],
    ['brand', BRAND_PAGE],
  ])('the %s page derives an id for rows older than the column', (_s, page) => {
    // Deliverables submitted before the migration have a null
    // `tiktok_video_id`; long-form URLs still carry it in the path, so those
    // rows keep in-app playback.
    expect(page).toContain(
      'video.tiktokVideoId ?? parseTiktokVideoId(video.tiktokUrl)'
    );
  });

  it.each([
    ['creator', CREATOR_PAGE],
    ['brand', BRAND_PAGE],
  ])('the %s page no longer prints the raw URL', (_side, page) => {
    // As a prop the URL is fine — as a rendered text child (`>{video.tiktokUrl}`)
    // or an href it would be the old raw-link UI back.
    expect(page).not.toMatch(/>\s*\{video\.tiktokUrl\}/);
    expect(page).not.toContain('href={video.tiktokUrl}');
  });
});
