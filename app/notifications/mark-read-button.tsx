'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Marks a single notification as read via `POST /api/notifications/read`
 * (KAN-96), optimistically: the row sheds its unread dress the moment the
 * button is pressed, and `router.refresh()` reconciles the chapters and the
 * unread count afterwards.
 *
 * The optimistic part touches the DOM directly — the row is server-rendered,
 * so there is no client state above this button to lift into. The button
 * strips the `bd-ntrow--new` class and the "New" marker from its own row and
 * hides itself; the refresh then replaces the whole tree with the truth. If
 * the POST fails the refresh restores the unread row, so a lie cannot stick.
 */
export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);

  async function handleMarkRead(event: React.MouseEvent<HTMLButtonElement>) {
    if (hidden) return;

    // Instant: the row reads as read before the network is consulted.
    const row = event.currentTarget.closest('li');
    row?.classList.remove('bd-ntrow--new');
    row?.querySelector('.bd-ntnew')?.remove();
    setHidden(true);

    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      });
    } finally {
      router.refresh();
    }
  }

  if (hidden) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleMarkRead}
      className="h-7 text-xs"
    >
      Mark read
    </Button>
  );
}
