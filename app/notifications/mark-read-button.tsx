'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Marks a single notification as read via `POST /api/notifications/read`,
 * then refreshes the page so the unread count and styling update (KAN-96).
 */
export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleMarkRead() {
    if (loading) return;
    setLoading(true);

    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={handleMarkRead}
      className="h-7 text-xs"
    >
      Mark read
    </Button>
  );
}
