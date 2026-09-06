import { afterEach, describe, expect, it, vi } from 'vitest';
import { forceCollide, forceSimulation, forceX, forceY } from 'd3-force';
import { scaleSqrt } from 'd3-scale';
import {
  ReachBubbles,
  type ReachVideo,
} from '@/components/brand/reach-bubbles';
import {
  settleReachSimulation,
  summarizeReachVideos,
} from '@/components/brand/reach-bubbles-layout';

const chart = vi.hoisted(() => ({
  host: null as unknown,
  effect: null as (() => void | (() => void)) | null,
  select: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: () => ({ current: chart.host }),
  useEffect: (effect: () => void | (() => void)) => {
    chart.effect = effect;
  },
}));

vi.mock('d3-selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('d3-selection')>()),
  select: chart.select,
}));

function videos(count: number, campaigns: number): ReachVideo[] {
  return Array.from({ length: count }, (_, i) => ({
    deliverableId: `video-${i}`,
    campaignId: `campaign-${i % campaigns}`,
    campaignName: `Campaign ${i % campaigns}`,
    creatorHandle: `creator-${i}`,
    views: i % 5 === 0 ? null : (i * 997) % 25000,
    likes: null,
    shares: null,
    comments: null,
    when: null,
  }));
}

function legacySummary(input: ReachVideo[]) {
  const campaigns = new Map<string, string>();
  for (const video of input) {
    if (!campaigns.has(video.campaignId)) {
      campaigns.set(video.campaignId, video.campaignName);
    }
  }
  const measured = input.filter((video) => video.views !== null);
  const globalAvg = measured.length
    ? measured.reduce((sum, video) => sum + (video.views ?? 0), 0) /
      measured.length
    : 1000;
  return {
    globalAvg,
    maxViews: Math.max(19000, ...measured.map((video) => video.views ?? 0)),
    campaigns: Array.from(campaigns, ([id, name], index) => {
      const own = input.filter((video) => video.campaignId === id);
      const withViews = own.filter((video) => video.views !== null);
      return {
        id,
        name,
        index,
        total: own.length,
        measured: withViews.length,
        average: withViews.length
          ? withViews.reduce((sum, video) => sum + (video.views ?? 0), 0) /
            withViews.length
          : globalAvg,
      };
    }),
  };
}

function frameQueue() {
  let time = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => time++);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => callbacks.delete(id))
  );
  return {
    callbacks,
    flush() {
      while (callbacks.size) {
        const [id, callback] = callbacks.entries().next().value!;
        callbacks.delete(id);
        callback(time);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reach bubble preparation', () => {
  it.each([
    [0, 1],
    [12, 3],
    [100, 8],
    [1000, 100],
    [10000, 1000],
  ])('matches legacy statistics for %i videos / %i campaigns', (n, c) => {
    const input = videos(n, c);
    const summary = summarizeReachVideos(input);
    expect({
      globalAvg: summary.globalAvg,
      maxViews: summary.maxViews,
      campaigns: Array.from(summary.campaigns, ([id, campaign]) => ({
        id,
        name: campaign.name,
        index: campaign.index,
        total: campaign.total,
        measured: campaign.measured,
        average: campaign.measured
          ? campaign.views / campaign.measured
          : summary.globalAvg,
      })),
    }).toEqual(legacySummary(input));
  });

  it('keeps first-seen names/order, null fallback, and measured zero distinct', () => {
    const input = videos(4, 3);
    input[0].views = 0;
    input[1].views = null;
    input[2].views = 300;
    input[3].views = null;
    input[3].campaignName = 'Ignored later name';
    const summary = summarizeReachVideos(input);
    expect(summary.globalAvg).toBe(150);
    expect(Array.from(summary.campaigns.values())).toEqual([
      { name: 'Campaign 0', index: 0, total: 2, measured: 1, views: 0 },
      { name: 'Campaign 1', index: 1, total: 1, measured: 0, views: 0 },
      { name: 'Campaign 2', index: 2, total: 1, measured: 1, views: 300 },
    ]);
    expect(
      summarizeReachVideos(input.map((video) => ({ ...video, views: null })))
        .globalAvg
    ).toBe(1000);
  });

  it('visits each video once even when every video has its own campaign', () => {
    const input = videos(1000, 1000);
    const iterator = vi.spyOn(input, Symbol.iterator);
    const reads = input.map((video) => {
      const id = video.campaignId;
      const get = vi.fn(() => id);
      Object.defineProperty(video, 'campaignId', { get });
      return get;
    });
    summarizeReachVideos(input);
    expect(iterator).toHaveBeenCalledTimes(1);
    for (const read of reads) expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('frame-budgeted reach layout', () => {
  it('matches all 260 synchronous force ticks exactly after yielding', () => {
    const queue = frameQueue();
    const size = scaleSqrt([0, 19000], [0, 32]);
    const initial = Array.from({ length: 100 }, (_, i) => ({
      c: i % 8,
      r: size((i * 997) % 19000),
      x: (680 / 8) * ((i % 8) + 0.5) + ((i * 37) % 30) - 15,
      y: 115 + ((i * 53) % 30) - 15,
    }));
    const simulate = () =>
      forceSimulation(initial.map((node) => ({ ...node })))
        .force(
          'x',
          forceX<(typeof initial)[number]>(
            (d) => (680 / 8) * (d.c + 0.5)
          ).strength(0.14)
        )
        .force('y', forceY(115).strength(0.12))
        .force(
          'collide',
          forceCollide<(typeof initial)[number]>((d) => d.r + 2.5)
        )
        .stop();
    const baseline = simulate();
    baseline.tick(260);
    const batched = simulate();
    const tick = vi.spyOn(batched, 'tick');
    const settled = vi.fn();
    const cancel = settleReachSimulation(batched, settled);
    expect(settled).not.toHaveBeenCalled();
    expect(queue.callbacks.size).toBe(1);
    queue.flush();
    expect(tick).toHaveBeenCalledTimes(260);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(batched.nodes()).toEqual(baseline.nodes());
    cancel();
    baseline.stop();
  });

  it('cancels queued work and ignores a stale callback after cleanup', () => {
    const queue = frameQueue();
    const simulation = { tick: vi.fn(), stop: vi.fn() };
    const settled = vi.fn();
    const cancel = settleReachSimulation(simulation, settled);
    const stale = Array.from(queue.callbacks.values())[0];
    const ticks = simulation.tick.mock.calls.length;
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(260);
    cancel();
    expect(queue.callbacks.size).toBe(0);
    stale(0);
    queue.flush();
    expect(simulation.tick).toHaveBeenCalledTimes(ticks);
    expect(simulation.stop).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
  });

  it('finishes inexpensive layouts synchronously without an extra frame', () => {
    frameQueue();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const simulation = { tick: vi.fn(), stop: vi.fn() };
    const settled = vi.fn();
    const cancel = settleReachSimulation(simulation, settled);
    expect(simulation.tick).toHaveBeenCalledTimes(260);
    expect(settled).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    cancel();
  });
});

describe('reach bubble interaction orchestration', () => {
  function mount(reduce: boolean, timed = false) {
    const queue = frameQueue();
    if (!timed) vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: reduce }) });
    const tip = { className: '', style: {}, innerHTML: '', remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => tip });
    const skeleton = { hidden: false };
    chart.host = {
      querySelector: () => skeleton,
      appendChild: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    const selection = {
      append: vi.fn().mockReturnThis(),
      attr: vi.fn().mockReturnThis(),
      style: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      data: vi.fn().mockReturnThis(),
      join: vi.fn().mockReturnThis(),
      transition: vi.fn().mockReturnThis(),
      duration: vi.fn().mockReturnThis(),
      delay: vi.fn().mockReturnThis(),
      ease: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      interrupt: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      node: () => ({
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 680,
          height: 252,
        }),
      }),
    };
    chart.select.mockReturnValue(selection);
    ReachBubbles({ videos: videos(12, 3) });
    const cleanup = chart.effect!();
    return {
      selection,
      get events() {
        return new Map(
          selection.on.mock.calls.map(
            ([event, handler]) => [event, handler] as const
          )
        );
      },
      get node() {
        return selection.data.mock.calls[0][0][0];
      },
      cleanup,
      tip,
      skeleton,
      queue,
    };
  }

  it('keeps radius and opacity transitions independent, without restarting on move', () => {
    const { selection, events, node, cleanup, tip, skeleton } = mount(false);
    expect(skeleton.hidden).toBe(true);
    expect(selection.transition.mock.calls).toEqual([['entrance']]);
    expect(selection.duration).toHaveBeenCalledWith(700);
    expect(selection.delay.mock.calls[0][0](node, 2)).toBe(340);

    events.get('mouseenter')(null, node);
    expect(selection.transition.mock.calls).toEqual([['entrance'], ['hover']]);
    const writesBeforeMove = selection.attr.mock.calls.length;
    for (let i = 0; i < 100; i += 1) events.get('mousemove')(null, node);
    expect(selection.transition).toHaveBeenCalledTimes(2);
    expect(selection.attr).toHaveBeenCalledTimes(writesBeforeMove);
    expect(tip.style).toMatchObject({ opacity: '1' });
    expect(tip.innerHTML).toContain('view data pending');

    events.get('mouseleave')();
    expect(selection.transition.mock.calls).toEqual([
      ['entrance'],
      ['hover'],
      ['hover'],
    ]);
    expect(selection.duration).toHaveBeenLastCalledWith(120);
    expect(tip.style).toMatchObject({ opacity: '0' });
    if (cleanup) cleanup();
    expect(selection.interrupt.mock.calls).toEqual([['entrance'], ['hover']]);
    expect(selection.remove).toHaveBeenCalledOnce();
    expect(tip.remove).toHaveBeenCalledOnce();
    expect(skeleton.hidden).toBe(false);
  });

  it('sets final radii immediately for reduced motion', () => {
    const { selection, node, cleanup } = mount(true);
    expect(selection.transition).not.toHaveBeenCalled();
    const radius = selection.attr.mock.calls.find(([name]) => name === 'r');
    expect(radius?.[1](node)).toBe(node.r);
    if (cleanup) cleanup();
  });

  it('keeps the skeleton until all ticks finish and never exposes a partial chart', () => {
    const { selection, skeleton, queue, cleanup } = mount(false, true);
    expect(skeleton.hidden).toBe(false);
    expect(selection.append).not.toHaveBeenCalled();
    queue.flush();
    expect(skeleton.hidden).toBe(true);
    expect(selection.append).toHaveBeenCalledWith('svg');
    if (cleanup) cleanup();
    expect(skeleton.hidden).toBe(false);
  });

  it('does not create chart DOM when cleaned up before settling', () => {
    const { selection, skeleton, queue, cleanup } = mount(false, true);
    if (cleanup) cleanup();
    queue.flush();
    expect(selection.append).not.toHaveBeenCalled();
    expect(skeleton.hidden).toBe(false);
  });
});
