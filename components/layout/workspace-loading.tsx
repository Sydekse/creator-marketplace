import { cn } from '@/lib/utils';

/**
 * Route loading: the light mark SVG, not a fake page.
 *
 * Geometry matches `logo/mark-light.svg` — paper tile, ink circle, grey
 * circle. In-app navigations keep the real header; this fills the main
 * column. `full` is for `/dashboard`, which has no nav yet.
 */
export function WorkspaceLoading({ full = false }: { full?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className={cn(
        'flex items-center justify-center',
        full ? 'min-h-[100dvh] bg-neutral-50' : 'min-h-[min(28rem,70dvh)]'
      )}
    >
      <span className="grid size-20 place-items-center rounded-[22px] bg-neutral-900 shadow-[0_12px_32px_rgba(23,23,23,0.18)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="mark-load h-14 w-14"
        >
          <rect width="24" height="24" rx="8" fill="#fafafa" />
          <g className="mark-load-pair">
            <rect
              className="mark-load-a"
              x="6"
              y="6"
              width="8"
              height="8"
              rx="4"
              fill="#171717"
            />
            <rect
              className="mark-load-b"
              x="10"
              y="10"
              width="8"
              height="8"
              rx="4"
              fill="#d4d4d4"
            />
          </g>
        </svg>
      </span>
      <span className="sr-only">Loading</span>
    </div>
  );
}
