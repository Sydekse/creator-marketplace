'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';

/**
 * Session controls. Revoking is optimistic in feel but honest in fact: the
 * row disappears only after Better Auth confirms, and `router.refresh()`
 * re-reads the list after a successful revocation.
 */
export function RevokeSessionButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await authClient.revokeSession({ token });
      if (error) {
        toast.error(error.message ?? 'Could not sign out. Please try again.');
        return;
      }
      router.refresh();
    } catch {
      toast.error('Could not sign out. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="bd-btn bd-btn--ghost bd-stbtn"
      onClick={() => void revoke()}
      disabled={busy}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

/** One control for "everywhere that is not here". */
export function RevokeOthersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        toast.error(
          error.message ??
            'Could not sign out other sessions. Please try again.'
        );
        return;
      }
      router.refresh();
    } catch {
      toast.error(
        'Could not sign out other sessions. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="bd-btn bd-btn--ghost bd-stbtn bd-stbtn--danger"
      onClick={() => void revoke()}
      disabled={busy}
    >
      {busy ? 'Signing out…' : 'Sign out everywhere else'}
    </button>
  );
}
