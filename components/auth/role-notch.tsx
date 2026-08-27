'use client';

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
 */
export function RoleNotch({
  value,
  onChange,
}: {
  value: SelfRegisterableRole;
  onChange: (next: SelfRegisterableRole) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="absolute left-1/2 top-0 z-10 w-[min(100%-2.5rem,17.5rem)] -translate-x-1/2 -translate-y-[42%]">
      <div
        role="tablist"
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
        {ROLES.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(option.value)}
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
  );
}
