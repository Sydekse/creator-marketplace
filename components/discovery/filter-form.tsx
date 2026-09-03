'use client';

import { useRouter } from 'next/navigation';

/**
 * Progressive enhancement for the discover filter form.
 *
 * The form stays a real `method="GET"` form — with JavaScript disabled the
 * browser submits it natively and the URL is still the state. With JavaScript,
 * submit becomes a client-side navigation instead of a full document load, so
 * the keyed Suspense boundary around the results swaps in the in-column
 * loader while the masthead and this very rail hold still.
 *
 * Empty fields are dropped from the query string on the enhanced path — the
 * URL a brand shares reads `?niche=fitness`, not a fence of empty params.
 */
export function DiscoverFilterForm({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <form
      method="GET"
      action="/discover"
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const query = new URLSearchParams();
        for (const [key, value] of data.entries()) {
          if (typeof value === 'string' && value.trim() !== '') {
            query.set(key, value);
          }
        }
        const qs = query.toString();
        router.push(qs ? `/discover?${qs}` : '/discover');
      }}
    >
      {children}
    </form>
  );
}
