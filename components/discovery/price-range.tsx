'use client';

import { useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

const TRIGGER_CLASS =
  'h-11 w-full rounded-lg border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:border-neutral-400 focus-visible:border-brand focus-visible:ring-brand/20';
const ITEM_CLASS =
  'rounded-lg py-2.5 pl-3 pr-8 text-sm font-medium text-neutral-800 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-40';
const ANY_ITEM_CLASS =
  'rounded-lg py-2.5 pl-3 pr-8 text-sm text-neutral-600 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink';
/* The popup grows past its half-width trigger so labels and the selected
   tick never collide. */
const CONTENT_CLASS =
  'w-max min-w-(--anchor-width) max-w-72 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.45)]';

/**
 * The price range as one coordinated control: the two selects know each
 * other, so an inverted range cannot be picked — the max list disables
 * everything below the chosen min and vice versa. The server still refines
 * `priceMin <= priceMax` for hand-crafted URLs; this keeps honest hands off
 * that error page entirely.
 *
 * Values are integer santim strings (invariant 4); comparison is numeric.
 * Hidden inputs carry the pair on the GET form, and each change re-dispatches
 * a bubbling `change` so the live filter count hears it.
 */
export function PriceRange({
  min,
  max,
  options,
}: {
  min?: string;
  max?: string;
  options: Array<{ value: string; label: string }>;
}) {
  const [minValue, setMinValue] = useState(min || 'any');
  const [maxValue, setMaxValue] = useState(max || 'any');
  const minInputRef = useRef<HTMLInputElement>(null);
  const maxInputRef = useRef<HTMLInputElement>(null);

  const announce = (ref: React.RefObject<HTMLInputElement | null>) =>
    queueMicrotask(() =>
      ref.current?.dispatchEvent(new Event('change', { bubbles: true }))
    );

  // The tier bracket ("(Mid)") helps choose inside the open list; the closed
  // trigger shows only the figure.
  const label = (value: string, placeholder: string) =>
    value === 'any'
      ? placeholder
      : (options
          .find((o) => o.value === value)
          ?.label.replace(/\s*\([^)]*\)$/, '') ?? placeholder);

  return (
    <div className="bd-discrange">
      <input
        ref={minInputRef}
        type="hidden"
        name="price_min"
        value={minValue === 'any' ? '' : minValue}
      />
      <input
        ref={maxInputRef}
        type="hidden"
        name="price_max"
        value={maxValue === 'any' ? '' : maxValue}
      />

      <Select
        value={minValue}
        onValueChange={(next) => {
          setMinValue(next ?? 'any');
          announce(minInputRef);
        }}
      >
        <SelectTrigger
          size="default"
          aria-label="Minimum price per video"
          className={TRIGGER_CLASS}
        >
          <span
            data-slot="select-value"
            className={`min-w-0 flex-1 truncate text-left ${
              minValue === 'any' ? 'text-muted-foreground' : ''
            }`}
          >
            {label(minValue, 'Min')}
          </span>
        </SelectTrigger>
        <SelectContent align="start" className={CONTENT_CLASS}>
          <SelectItem value="any" className={ANY_ITEM_CLASS}>
            Min
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={
                maxValue !== 'any' && Number(option.value) > Number(maxValue)
              }
              className={ITEM_CLASS}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="bd-discrangedash" aria-hidden="true">
        &ndash;
      </span>

      <Select
        value={maxValue}
        onValueChange={(next) => {
          setMaxValue(next ?? 'any');
          announce(maxInputRef);
        }}
      >
        <SelectTrigger
          size="default"
          aria-label="Maximum price per video"
          className={TRIGGER_CLASS}
        >
          <span
            data-slot="select-value"
            className={`min-w-0 flex-1 truncate text-left ${
              maxValue === 'any' ? 'text-muted-foreground' : ''
            }`}
          >
            {label(maxValue, 'Max')}
          </span>
        </SelectTrigger>
        <SelectContent align="start" className={CONTENT_CLASS}>
          <SelectItem value="any" className={ANY_ITEM_CLASS}>
            Max
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={
                minValue !== 'any' && Number(option.value) < Number(minValue)
              }
              className={ITEM_CLASS}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
