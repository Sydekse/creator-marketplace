'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { SlotText } from 'slot-text/react';
import 'slot-text/style.css';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { SelfRegisterableRole } from '@/lib/auth-policy';

const PANEL_COPY: Record<
  SelfRegisterableRole,
  { top: string; bottom: string; note: string }
> = {
  brand: {
    top: 'Review first.',
    bottom: 'Pay with confidence.',
    note: 'Brand',
  },
  creator: {
    top: 'Accept with clarity.',
    bottom: 'Deliver with proof.',
    note: 'Creator',
  },
};

export const AUTH_ROLE_EVENT = 'auth-role-change';

export function AuthPanel() {
  const [role, setRole] = useState<SelfRegisterableRole>('brand');
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    function handleRoleChange(event: Event) {
      const next = (event as CustomEvent<{ role?: SelfRegisterableRole }>)
        .detail?.role;
      if (next === 'brand' || next === 'creator') setRole(next);
    }

    window.addEventListener(AUTH_ROLE_EVENT, handleRoleChange);
    return () => window.removeEventListener(AUTH_ROLE_EVENT, handleRoleChange);
  }, []);

  return (
    <aside
      aria-hidden
      className="auth-reveal-panel relative hidden overflow-hidden bg-neutral-50 lg:grid lg:place-items-center lg:p-12 xl:p-16"
    >
      <div className="absolute -top-8 -right-8 -bottom-8 -left-74 overflow-hidden [mask-image:linear-gradient(to_right,transparent_0%,transparent_45%,rgba(0,0,0,0.03)_50%,rgba(0,0,0,0.09)_57%,rgba(0,0,0,0.2)_66%,rgba(0,0,0,0.42)_76%,rgba(0,0,0,0.68)_88%,rgba(0,0,0,0.88)_96%,black_100%)]">
        <Image
          src="/marketing/auth-panel-teal.webp"
          alt=""
          fill
          sizes="44vw"
          className="object-cover blur-sm"
          priority
        />
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-neutral-50" />
      <div className="relative grid w-full max-w-[33rem] -translate-x-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-6 text-left xl:-translate-x-16">
        <div className="font-display text-[3.35rem] font-semibold leading-[0.78] tracking-[-0.08em] text-[oklch(0.18_0.055_185)] xl:text-[3.8rem]">
          <span className="block">Tap</span>
          <span className="block pl-7 text-[oklch(0.32_0.085_185)]">tap</span>
        </div>

        <div className="min-w-0 min-h-[10rem] border-l border-[oklch(0.28_0.07_185/0.24)] pl-6">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[oklch(0.28_0.07_185)]">
            <SlotText
              text={PANEL_COPY[role].note}
              options={
                reduceMotion
                  ? { duration: 0, stagger: 0 }
                  : {
                      rollBy: 'character',
                      direction: role === 'brand' ? 'down' : 'up',
                      duration: 260,
                      stagger: 28,
                      exitOffset: 45,
                      bounce: 0.35,
                      color: 'oklch(0.32 0.085 185)',
                      skipUnchanged: false,
                    }
              }
            />
          </p>
          <p className="mt-4 font-display text-[2.15rem] font-semibold leading-[1.04] tracking-tight text-[oklch(0.16_0.052_185)] xl:text-[2.5rem]">
            <span className="block">
              <SlotText
                text={PANEL_COPY[role].top}
                options={
                  reduceMotion
                    ? { duration: 0, stagger: 0 }
                    : {
                        rollBy: 'word',
                        direction: role === 'brand' ? 'down' : 'up',
                        duration: 420,
                        stagger: 70,
                        exitOffset: 80,
                        bounce: 0.5,
                        color: 'oklch(0.28 0.085 185)',
                        skipUnchanged: false,
                      }
                }
              />
            </span>
            <span className="mt-1 block text-[oklch(0.24_0.07_185)]">
              <SlotText
                text={PANEL_COPY[role].bottom}
                options={
                  reduceMotion
                    ? { duration: 0, stagger: 0 }
                    : {
                        rollBy: 'word',
                        direction: role === 'brand' ? 'up' : 'down',
                        duration: 420,
                        stagger: 70,
                        exitOffset: 80,
                        bounce: 0.5,
                        color: 'oklch(0.36 0.095 185)',
                        skipUnchanged: false,
                      }
                }
              />
            </span>
          </p>
        </div>
      </div>
    </aside>
  );
}
