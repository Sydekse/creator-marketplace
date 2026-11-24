'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Live tally of applied filters in the discover rail header.
 *
 * The chip must move the moment a select changes — before the form is ever
 * submitted — so it counts the form's *current* field values on the client
 * rather than the parsed URL on the server. The server still provides the
 * initial count so the first paint is correct without JavaScript.
 *
 * The span always renders (hidden at zero) so the effect can find its form
 * once and keep listening; `FilterSelect` re-dispatches a bubbling `change`
 * from its hidden input, and the native engagement input fires `input`.
 */
const COUNTED_FIELDS = [
  'niche',
  'audience',
  'price_min',
  'price_max',
  'min_engagement',
];

export function FilterCount({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const recount = () => {
      const data = new FormData(form);
      let next = 0;
      for (const field of COUNTED_FIELDS) {
        const value = data.get(field);
        if (typeof value === 'string' && value.trim() !== '') next += 1;
      }
      setCount(next);
    };
    form.addEventListener('change', recount);
    form.addEventListener('input', recount);
    return () => {
      form.removeEventListener('change', recount);
      form.removeEventListener('input', recount);
    };
  }, []);

  return (
    <span
      ref={ref}
      className={cn(
        'bd-discactivecount bd-mono',
        count === 0 && 'bd-discactivecount--none'
      )}
    >
      {count} active
    </span>
  );
}
