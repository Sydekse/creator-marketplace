'use client';

import { useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

export function FilterSelect({
  name,
  value,
  placeholder,
  options,
  ariaLabel,
}: {
  name: string;
  value?: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  /** For selects labelled by a shared group heading rather than their own. */
  ariaLabel?: string;
}) {
  const [selected, setSelected] = useState(value || 'any');
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="hidden"
        name={name}
        value={selected === 'any' ? '' : selected}
      />
      <Select
        value={selected}
        onValueChange={(next) => {
          setSelected(next ?? 'any');
          // React updates the hidden input without firing anything the form
          // can hear — re-dispatch a bubbling change after the value commits
          // so listeners (the live filter count) see the new state.
          queueMicrotask(() =>
            inputRef.current?.dispatchEvent(
              new Event('change', { bubbles: true })
            )
          );
        }}
      >
        <SelectTrigger
          size="default"
          aria-label={ariaLabel}
          className="h-11 w-full rounded-lg border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:border-neutral-400 focus-visible:border-brand focus-visible:ring-brand/20"
        >
          {/* The trigger names the choice itself — the batch bar's precedent.
              Base UI's Value can echo the raw value before items resolve,
              which for the price selects reads as bare santim. */}
          <span
            data-slot="select-value"
            className={`min-w-0 flex-1 truncate text-left ${
              selected === 'any' ? 'text-muted-foreground' : ''
            }`}
          >
            {selected === 'any'
              ? placeholder
              : (options.find((o) => o.value === selected)?.label ??
                placeholder)}
          </span>
        </SelectTrigger>
        <SelectContent
          align="start"
          className="w-max min-w-(--anchor-width) max-w-72 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.45)]"
        >
          <SelectItem
            value="any"
            className="rounded-lg py-2.5 pl-3 pr-8 text-sm text-neutral-600 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink"
          >
            {placeholder}
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="rounded-lg py-2.5 pl-3 pr-8 text-sm font-medium text-neutral-800 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
