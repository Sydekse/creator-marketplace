'use client';

import { useEffect, useState } from 'react';
import { SlotText } from 'slot-text/react';
import 'slot-text/style.css';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { SelfRegisterableRole } from '@/lib/auth-policy';
import { cn } from '@/lib/utils';

/**
 * The "Tap tap" lockup from the auth side panel, now serving as the landing
 * hero headline: the stacked wordmark beside the escrow claim. The auth page
 * swaps the claim when the visitor moves the brand/creator slider; the landing
 * page has no slider, so the claim cycles between the two roles on a slow
 * timer and stands still under `prefers-reduced-motion`.
 */
const CLAIMS: Record<
  SelfRegisterableRole,
  { role: string; top: string; bottom: string }
> = {
  brand: {
    role: 'Brand',
    top: 'Review first.',
    bottom: 'Pay with confidence.',
  },
  creator: {
    role: 'Creator',
    top: 'Accept with clarity.',
    bottom: 'Deliver with proof.',
  },
};

const CYCLE_MS = 4800;

const NOTE_CLASSES =
  'block font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.28_0.07_185)]';
const TOP_CLASSES =
  'font-display text-2xl font-semibold leading-[1.06] tracking-tight text-brand-ink sm:text-[2.15rem] xl:text-[2.45rem]';
const BOTTOM_CLASSES =
  'font-display text-2xl font-semibold leading-[1.06] tracking-tight text-brand-ink sm:text-[2.15rem] xl:text-[2.45rem]';

export function TapTapHeadline({ className }: { className?: string }) {
  const [role, setRole] = useState<SelfRegisterableRole>('brand');
  const reduceMotion = useReducedMotion();
  const otherRole: SelfRegisterableRole =
    role === 'brand' ? 'creator' : 'brand';

  useEffect(() => {
    if (reduceMotion) return;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (intervalId === undefined) {
        intervalId = setInterval(() => {
          setRole((current) => (current === 'brand' ? 'creator' : 'brand'));
        }, CYCLE_MS);
      }
    };
    const stop = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    // A roll firing while the tab is hidden lands as a burst on return.
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduceMotion]);

  // Same roll grammar as the auth panel: the note and top line enter from one
  // direction, the bottom line answers from the other, and each line carries
  // its own roll tint.
  const roll = (
    rollBy: 'character' | 'word',
    direction: 'down' | 'up',
    color?: string
  ) =>
    reduceMotion
      ? { duration: 0, stagger: 0 }
      : {
          rollBy,
          direction,
          duration: rollBy === 'character' ? 390 : 640,
          stagger: rollBy === 'character' ? 42 : 105,
          exitOffset: rollBy === 'character' ? 45 : 80,
          bounce: rollBy === 'character' ? 0.35 : 0.5,
          color,
          skipUnchanged: false,
        };

  return (
    <h1 className={cn('flex items-center gap-6', className)}>
      <span className="font-display text-[3.35rem] font-semibold leading-[1.023] tracking-[-0.08em] text-[oklch(0.18_0.055_185)] lg:text-[3.65rem] xl:text-[4rem]">
        <span className="block">Tap</span>
        <span className="block pl-[0.638em] text-[oklch(0.32_0.085_185)]">
          tap
        </span>
      </span>

      {/* The claim column is one grid. Two things keep it stable:
          — Width: invisible in-flow copies of the *other* role's lines share
            each row's cell, so the column is always as wide as the widest
            phrase. Slot-text rolls animate slot `width` — a layout property —
            and without the reservation every frame of the roll relayouts the
            lockup. With it, the reflow stays inside this block.
          — Rows: every child gets an explicit grid-area, including the
            visible ones. Grid auto-placement fills definite-position items
            first, so auto-placed children would land *below* the reserves
            and stack phantom rows on top of the claim.
          The rule owns a 10rem minimum height (like the auth panel's) and
          the rows center in it, so the claim text sits on the divider's
          midpoint alongside the wordmark. */}
      <span className="grid h-[10rem] min-w-0 flex-1 content-center border-l border-[oklch(0.28_0.07_185/0.24)] py-1 pl-6 [contain:layout] xl:overflow-clip [&>*]:[grid-area:var(--row)/1] [&>*:nth-child(even)]:invisible">
        {/* Row 1 — role note */}
        <span className={cn(NOTE_CLASSES, '[--row:1]')}>
          <SlotText
            text={CLAIMS[role].role}
            options={roll(
              'character',
              role === 'brand' ? 'down' : 'up',
              'oklch(0.32 0.085 185)'
            )}
          />
        </span>
        <span className={cn(NOTE_CLASSES, '[--row:1]')} aria-hidden>
          {CLAIMS[otherRole].role}
        </span>

        {/* Row 2 — top line */}
        <span className={cn(TOP_CLASSES, '[--row:2]', 'mt-3')}>
          <SlotText
            text={CLAIMS[role].top}
            options={roll(
              'word',
              role === 'brand' ? 'down' : 'up',
              'oklch(0.28 0.085 185)'
            )}
          />
        </span>
        <span className={cn(TOP_CLASSES, '[--row:2]', 'mt-3')} aria-hidden>
          {CLAIMS[otherRole].top}
        </span>

        {/* Row 3 — bottom line */}
        <span className={cn(BOTTOM_CLASSES, '[--row:3]')}>
          <SlotText
            text={CLAIMS[role].bottom}
            options={roll(
              'word',
              role === 'brand' ? 'up' : 'down',
              'oklch(0.36 0.095 185)'
            )}
          />
        </span>
        <span className={cn(BOTTOM_CLASSES, '[--row:3]')} aria-hidden>
          {CLAIMS[otherRole].bottom}
        </span>
      </span>
    </h1>
  );
}
