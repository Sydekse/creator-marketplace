'use client';

import { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { SelfRegisterableRole } from '@/lib/auth-policy';

const ROLES: { value: SelfRegisterableRole; label: string }[] = [
  { value: 'brand', label: 'Brand' },
  { value: 'creator', label: 'Creator' },
];

/**
 * Dynamic-island notch on the sign-up card. Selecting a role swaps the
 * process below: TikTok for creators, email for brands.
 *
 * The paper pill is a single element that translates inside an overflow-hidden
 * track — layoutId was flying it out of the island on switch.
 *
 * Semantics: this picks a value, so it is a radiogroup (not a tablist — there
 * are no tabpanels). Roving tabindex + arrow keys follow the radio pattern.
 */
export function RoleNotch({
  value,
  onChange,
}: {
  value: SelfRegisterableRole;
  onChange: (next: SelfRegisterableRole) => void;
}) {
  const reduceMotion = useReducedMotion();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const last = ROLES.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onChange(ROLES[next].value);
    optionRefs.current[next]?.focus();
  }

  return (
    // Grid instead of translate-x: a wrapper with `transform` anywhere above
    // this element would make `-translate-x-1/2` resolve against the wrong
    // box, which is how the island ended up off-centre after the auth-card
    // restyle. Place-content pins the island without a translation.
    <div className="absolute inset-x-0 top-0 z-10 grid justify-items-center -translate-y-[42%]">
      <div className="w-[min(calc(100%-2.5rem),17.5rem)]">
        <div
          role="radiogroup"
          aria-label="Account type"
          className="relative grid grid-cols-2 overflow-hidden rounded-full bg-neutral-900 p-1 shadow-[0_12px_32px_rgba(23,23,23,0.18)] ring-1 ring-neutral-50/10"
        >
          <div className="pointer-events-none absolute inset-1" aria-hidden>
            <motion.div
              className="h-full w-1/2 rounded-full bg-neutral-50"
              initial={false}
              animate={{ x: value === 'creator' ? '100%' : '0%' }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
              }
            />
          </div>
          {ROLES.map((option, index) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(option.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                className={cn(
                  'relative z-10 min-h-10 rounded-full px-4 text-sm font-medium transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50',
                  selected
                    ? 'text-neutral-900'
                    : 'text-neutral-300 hover:text-neutral-50'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
