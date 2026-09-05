'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/**
 * Session controls. Revoking is optimistic in feel but honest in fact: the
 * row disappears only after Better Auth confirms, and `router.refresh()`
 * re-reads the list either way.
 */
export function RevokeSessionButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await authClient.revokeSession({ token });
    } finally {
      router.refresh();
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
    setBusy(true);
    try {
      await authClient.revokeOtherSessions();
    } finally {
      router.refresh();
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
