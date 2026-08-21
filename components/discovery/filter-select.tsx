'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function FilterSelect({
  name,
  value,
  placeholder,
  options,
}: {
  name: string;
  value?: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  const [selected, setSelected] = useState(value || '__any__');

  return (
    <>
      <input
        type="hidden"
        name={name}
        value={selected === '__any__' ? '' : selected}
      />
      <Select
        value={selected}
        onValueChange={(next) => setSelected(next ?? '__any__')}
      >
        <SelectTrigger
          size="default"
          className="h-11 w-full rounded-lg border-neutral-300 bg-neutral-50 px-3 text-sm font-medium text-neutral-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:border-neutral-400 focus-visible:border-brand focus-visible:ring-brand/20"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          align="start"
          className="rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,23,0.45)]"
        >
          <SelectItem
            value="__any__"
            className="rounded-lg px-3 py-2.5 text-sm text-neutral-600 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink"
          >
            {placeholder}
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-800 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand-ink"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
