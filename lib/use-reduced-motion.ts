'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * `prefers-reduced-motion` as a boolean, without framer-motion. Matches the
 * framer hook's contract: falsy on the server render, live-updates when the
 * OS setting flips. Components that only gate motion on this flag should use
 * this instead of pulling the whole animation library into their chunk.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
