'use client';

import Link from 'next/link';

export const VIEW_DETAILS_LABEL = 'View details';

/**
 * "View details" — a real link that also marks the notification read (KAN-200).
 *
 * Opening a notification is reading it, so the unread state used to need a second
 * click on "Mark read" beside a link the user had already followed. That is the
 * whole of the fix; `MarkReadButton` stays for rows the user wants to clear
 * without opening.
 *
 * **Still a `<Link>`.** Middle-click, ⌘-click and "open in new tab" have to keep
 * working, and a `<button>` calling `router.push` breaks all three. `onClick`
 * fires alongside the navigation rather than instead of it — nothing here calls
 * `preventDefault`.
 *
 * **`keepalive` is load-bearing.** The navigation begins the moment the click is
 * handled, and a normal `fetch` from a page that is unloading is cancelled — the
 * request would leave and the row would stay unread, intermittently, which is the
 * worst version of this bug. `keepalive` tells the browser to let it finish
 * without the document.
 *
 * Nothing is awaited and no error is surfaced. The mark-read is a side effect of
 * reading, not the user's request: if it fails the row stays unread and "Mark
 * read" is still there, whereas a toast about it would interrupt a navigation the
 * user has already committed to.
 */
export function ViewDetailsLink({
  notificationId,
  href,
}: {
  notificationId: string;
  href: string;
}) {
  function markRead() {
    void fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId }),
      keepalive: true,
    }).catch(() => {
      // Deliberately silent — see the docstring.
    });
  }

  return (
    <Link
      href={href}
      onClick={markRead}
      className="text-sm font-medium text-neutral-900 underline-offset-4 hover:underline"
    >
      {VIEW_DETAILS_LABEL}
    </Link>
  );
}
