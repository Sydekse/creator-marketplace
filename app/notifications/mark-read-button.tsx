'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Marks a single notification as read via `POST /api/notifications/read`
 * (KAN-96), optimistically: the row sheds its unread dress the moment the
 * button is pressed, and `router.refresh()` reconciles the chapters and the
 * unread count afterwards.
 *
 * The optimistic part touches the DOM directly — the row is server-rendered,
 * so there is no client state above this button to lift into. The button
 * strips the `bd-ntrow--new` class and hides the "New" marker in its own row and
 * hides itself; the refresh then reconciles server data. If the POST fails,
 * it restores those changes directly, even when refresh preserves the row.
 */
export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleMarkRead(event: React.MouseEvent<HTMLButtonElement>) {
    if (pending.current || hidden) return;
    pending.current = true;

    // Instant: the row reads as read before the network is consulted.
    const row = event.currentTarget.closest('li');
    const wasUnread = row?.classList.contains('bd-ntrow--new') ?? false;
    const marker = row?.querySelector<HTMLElement>('.bd-ntnew');
    const markerWasHidden = marker?.hidden ?? false;
    row?.classList.remove('bd-ntrow--new');
    if (marker) marker.hidden = true;
    setHidden(true);

    try {
      const response = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      });
      if (!response.ok) throw new Error('Could not mark notification read.');
    } catch {
      if (mounted.current) {
        if (wasUnread) row?.classList.add('bd-ntrow--new');
        if (marker) marker.hidden = markerWasHidden;
        setHidden(false);
        toast.error('Could not mark as read. Please try again.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) router.refresh();
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
