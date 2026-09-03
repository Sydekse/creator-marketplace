'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { deepLink } from '@/lib/notifications/deep-link';
import { inAppNotificationDetail } from '@/lib/notifications/copy';
import type { UserRole } from '@/db/schema';

/**
 * Global toasts for freshly arrived, actionable notifications.
 *
 * Deliberately conservative — the bell badge is the ambient signal; a toast
 * is an interruption and has to earn it:
 * - Only types whose next action belongs to the recipient right now.
 * - Only rows created after this page loaded, never the backlog.
 * - At most two on screen; anything past that waits for the bell.
 * - Suppressed on /notifications, where the feed itself is the surface.
 * - Polls once a minute; no websocket exists and a tighter loop is not
 *   worth the query load.
 *
 * Clicking a toast is reading it: same POST + keepalive contract as the
 * feed's ViewDetailsLink, then the deep link.
 */

const POLL_MS = 60_000;
const MAX_VISIBLE = 2;
const TOAST_MS = 8_000;

/** The types worth an interruption, per recipient role. */
const ACTIONABLE: Record<UserRole, ReadonlySet<string>> = {
  brand: new Set(['offer_accepted', 'deliverable_submitted']),
  creator: new Set(['offer_received', 'revision_requested', 'campaign_funded']),
  admin: new Set<string>(),
};

const TOAST_TITLE: Record<string, string> = {
  offer_accepted: 'Ready to fund',
  deliverable_submitted: 'Video submitted',
  offer_received: 'New offer',
  revision_requested: 'Revision requested',
  campaign_funded: 'Campaign funded',
};

interface NotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

function toastDetail(type: string, payload: Record<string, unknown>): string {
  const shared = inAppNotificationDetail(type, payload);
  if (shared) return shared;
  const handle =
    typeof payload.creatorHandle === 'string'
      ? payload.creatorHandle
      : 'A creator';
  const company =
    typeof payload.companyName === 'string' ? payload.companyName : 'A brand';
  switch (type) {
    case 'deliverable_submitted':
      return `${handle} submitted a video for review.`;
    case 'offer_received':
      return `${company} sent you an offer.`;
    case 'revision_requested':
      return 'A video was sent back with requested changes.';
    case 'campaign_funded':
      return 'A campaign you accepted is funded. You can start filming.';
    default:
      return 'There is new activity on your account.';
  }
}

export function NotificationToaster({ role }: { role: UserRole }) {
  const router = useRouter();
  const pathname = usePathname();
  // Refs, not state: the interval must read fresh values without
  // re-subscribing, and nothing here renders.
  const watermark = useRef<string>(new Date().toISOString());
  const seen = useRef<Set<string>>(new Set());
  const visible = useRef(0);
  const onFeed = useRef(false);

  useEffect(() => {
    onFeed.current = pathname === '/notifications';
  }, [pathname]);

  useEffect(() => {
    if (ACTIONABLE[role].size === 0) return;
    let cancelled = false;

    function show(row: NotificationRow) {
      const payload = row.payload ?? {};
      const href = deepLink(row.type, payload, role);
      const title = TOAST_TITLE[row.type] ?? 'New activity';
      visible.current += 1;

      const id = toast.custom(
        () => (
          <button
            type="button"
            className="nt-toast"
            onClick={() => {
              void fetch('/api/notifications/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notificationId: row.id }),
                keepalive: true,
              }).catch(() => {
                // Silent: reading is the user's act, the mark is bookkeeping.
              });
              toast.dismiss(id);
              router.push(href);
            }}
          >
            <span className="nt-toast-head">
              <span className="nt-toast-chip">{title}</span>
              <span className="nt-toast-go" aria-hidden="true">
                Open →
              </span>
            </span>
            <span className="nt-toast-detail">
              {toastDetail(row.type, payload)}
            </span>
          </button>
        ),
        {
          duration: TOAST_MS,
          onDismiss: () => {
            visible.current = Math.max(0, visible.current - 1);
          },
          onAutoClose: () => {
            visible.current = Math.max(0, visible.current - 1);
          },
        }
      );
    }

    async function poll() {
      if (cancelled || onFeed.current || document.hidden) return;
      let rows: NotificationRow[];
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (!res.ok) return;
        rows = (await res.json()).notifications ?? [];
      } catch {
        return; // Silent: the bell still tells the truth.
      }

      for (const row of rows) {
        if (visible.current >= MAX_VISIBLE) break;
        if (row.readAt !== null) continue;
        if (row.createdAt <= watermark.current) continue;
        if (seen.current.has(row.id)) continue;
        if (!ACTIONABLE[role].has(row.type)) continue;
        seen.current.add(row.id);
        show(row);
      }
      // Advance so a toast dismissed unread is not re-raised next minute.
      if (rows[0] && rows[0].createdAt > watermark.current) {
        watermark.current = rows[0].createdAt;
      }
    }

    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [role, router]);

  return null;
}
