'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A yes/no confirmation in a real dialog — the replacement for every
 * `window.confirm` in the app.
 *
 * The native prompt blocked the main thread, wore the browser's chrome instead
 * of the product's, and announced itself to a screen reader as an unlabelled
 * system popup. This one is the same `Dialog` primitive `sheet.tsx` already
 * builds on: focus is trapped and restored, Escape and the backdrop cancel,
 * and the question is a labelled description rather than alert text.
 *
 * Design-system notes (docs/design.md):
 *  - Structure is a hairline and paper, not a glow: one soft ambient shadow on
 *    the floating surface, tinted to the ink hue, never stacked.
 *  - Motion is a whisper — opacity + a 4px translate on the product's
 *    decelerating easing, transform/opacity only, and Base UI's
 *    data-starting/ending-style hooks so the open/close transition stays CSS.
 *  - The destructive tone spends the one red the status vocabulary owns; the
 *    default confirm is ink, never the teal accent — accent is for emphasis,
 *    and a confirmation is a decision, not decoration.
 *
 * Controlled rather than trigger-wired because every call site gates an async
 * action: the caller opens the dialog, and `onConfirm` runs the fetch — the
 * dialog never needs to know what it is confirming.
 */
export interface ConfirmDialogProps {
  open: boolean;
  /** Called for every close — confirm, cancel, Escape, backdrop. */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The sentence `window.confirm` used to carry. */
  description: string;
  /** Defaults to `title` when the action and the question are the same words. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions (cancel, remove) get the red confirm button. */
  tone?: 'default' | 'destructive';
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop dims, it does not blur — the paper underneath stays paper. */}
        <DialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-neutral-900/40',
            'transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            'data-ending-style:opacity-0 data-starting-style:opacity-0'
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            // Centered by transform so the entrance animates transform+opacity
            // only — never top/left/width/height.
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
            // Hairline + paper + one ambient shadow; the radius is the card
            // tier (16px) since the popup carries no padding of its own frame.
            'flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-6',
            'shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)]',
            'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            // 4px on the grid — a whisper, not a bounce.
            'data-ending-style:-translate-y-[calc(50%+4px)] data-ending-style:opacity-0',
            'data-starting-style:-translate-y-[calc(50%-4px)] data-starting-style:opacity-0'
          )}
        >
          <div className="flex flex-col gap-1.5">
            {/* Sans, not serif: the serif is for page headlines, never inside
                a working surface. */}
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-neutral-900">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm leading-relaxed text-neutral-600">
              {description}
            </DialogPrimitive.Description>
          </div>
          <div className="flex justify-end gap-2">
            <DialogPrimitive.Close
              render={<Button variant="outline" size="sm" />}
            >
              {cancelLabel}
            </DialogPrimitive.Close>
            <Button
              variant={tone === 'destructive' ? 'destructive' : 'default'}
              size="sm"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel ?? title}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
