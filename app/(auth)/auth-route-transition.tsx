'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';

export function AuthRouteTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const isSignUp = pathname === '/sign-up';
  const direction = isSignUp ? 1 : -1;

  return (
    <div className="relative grid min-h-[40rem] w-full place-items-center py-4 sm:min-h-[38rem]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          className="grid w-full place-items-center"
          initial={
            reduceMotion
              ? { opacity: 1 }
              : { opacity: 0, x: 10 * direction, y: 3, scale: 0.998 }
          }
          animate={
            reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, y: 0, scale: 1 }
          }
          exit={
            reduceMotion
              ? { opacity: 1 }
              : { opacity: 0, x: -8 * direction, y: 0, scale: 0.998 }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.18, ease: 'easeOut' },
                  x: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                  y: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                  scale: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                }
          }
          style={{ transformOrigin: '50% 50%' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
