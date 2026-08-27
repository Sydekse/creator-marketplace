'use client';

import { Children, type ReactNode } from 'react';
import { Reveal } from '@/components/marketing/reveal';

/**
 * Staggers legal sections (80ms cascade). Parent + children live in this
 * client leaf so the delay is not split across server/client trees.
 */
export function LegalSections({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.map(children, (child, index) => (
        <Reveal delay={index * 80}>{child}</Reveal>
      ))}
    </>
  );
}
