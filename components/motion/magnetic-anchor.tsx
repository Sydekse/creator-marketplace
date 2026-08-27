'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Magnetic outbound control. Motion values stay off the React render path
 * (design-taste MOTION_INTENSITY 6). Reduced-motion users get a plain anchor.
 */
export function MagneticAnchor({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 100, damping: 20, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 100, damping: 20, mass: 0.4 });
  const rotateX = useTransform(springY, [-12, 12], [4, -4]);
  const rotateY = useTransform(springX, [-12, 12], [-4, 4]);

  function onMove(event: MouseEvent<HTMLAnchorElement>) {
    if (reduceMotion) return;
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    x.set(event.clientX - box.left - box.width / 2);
    y.set(event.clientY - box.top - box.height / 2);
  }

  function onLeave() {
    x.set(0);
    y.set(0);
  }

  const anchor = (
    <a
      ref={ref}
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn(className)}
    >
      {children}
    </a>
  );

  if (reduceMotion) return anchor;

  return (
    <motion.div
      className="inline-flex"
      style={{ x: springX, y: springY, rotateX, rotateY }}
    >
      {anchor}
    </motion.div>
  );
}
