'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface BrandWorkspaceStep {
  title: string;
  desc: string;
}

export function BrandWorkspaceScrollRail({
  steps,
}: {
  steps: BrandWorkspaceStep[];
}) {
  const [active, setActive] = useState(0);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const items = itemRefs.current.filter(Boolean) as HTMLLIElement[];
    if (items.length === 0 || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.index))
          .filter(Number.isFinite);

        if (visible.length > 0) setActive(Math.max(...visible));
      },
      {
        threshold: 0.52,
        rootMargin: '-30% 0px -42% 0px',
      }
    );

    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  const fill = steps.length <= 1 ? 100 : (active / (steps.length - 1)) * 100;

  return (
    <div className="relative h-full">
      <span
        aria-hidden
        className="absolute top-[18px] bottom-[18px] left-[18px] hidden w-px bg-neutral-200 lg:block"
      />
      <span
        aria-hidden
        className="absolute top-[18px] left-[18px] hidden w-px bg-brand transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block"
        style={{ height: `calc((100% - 36px) * ${fill / 100})` }}
      />
      <ol className="lg:flex lg:h-full lg:flex-col">
        {steps.map((step, i) => {
          const lit = i <= active;
          return (
            <li
              key={step.title}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-index={i}
              className="group relative flex gap-5 pb-9 last:pb-0 sm:gap-6 lg:flex-1 lg:pb-0 lg:last:flex-none"
            >
              <div className="relative z-[1] flex flex-col items-center">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium tabular-nums transition-all duration-300 ease-out',
                    lit
                      ? 'node-breathe border-brand bg-brand text-neutral-50 shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.15)]'
                      : 'border-[oklch(0.79_0.004_220)] bg-white text-neutral-600 group-hover:border-brand group-hover:text-brand group-hover:shadow-[0_0_0_4px_oklch(0.51_0.11_185/0.1)]'
                  )}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      'mt-2 w-px flex-1 transition-colors duration-300 ease-out lg:hidden',
                      lit ? 'bg-brand/55' : 'bg-neutral-200'
                    )}
                  />
                )}
              </div>
              <div className="pt-1.5 transition-transform duration-300 ease-out group-hover:translate-x-0.5">
                <h3
                  className={cn(
                    'font-display text-lg font-medium leading-snug transition-colors duration-300 ease-out sm:text-xl',
                    lit
                      ? 'text-brand'
                      : 'text-neutral-900 group-hover:text-brand-ink'
                  )}
                >
                  {step.title}
                </h3>
                <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-neutral-600">
                  {step.desc}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
