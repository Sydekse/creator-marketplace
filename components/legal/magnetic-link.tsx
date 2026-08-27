'use client';

import { useRef, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

/**
 * Isolated magnetic CTA. Motion values stay off the React render path
 * (design-taste MOTION_INTENSITY 6). Reduced-motion users get a plain link.
 */
export function MagneticLink({
  href,
  children,
}: {
  href: string;
  children: string;
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

  return (
    <motion.div style={{ x: springX, y: springY, rotateX, rotateY }}>
      <Link
        ref={ref}
        href={href}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="btn-shine inline-flex rounded-full bg-neutral-50 px-4 py-2 text-[13px] font-medium text-neutral-900 transition-colors duration-300 ease-out hover:bg-neutral-100 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
      >
        {children}
      </Link>
    </motion.div>
  );
}
