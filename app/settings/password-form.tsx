'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

/**
 * Change password, collapsed to a row until asked for. Better Auth's
 * `changePassword` verifies the current password server-side; other sessions
 * are revoked on success, because a password change usually means doubt.
 */
export function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'Could not change the password.');
      return;
    }
    setOpen(false);
    setDone(true);
    setCurrent('');
    setNext('');
  }

  if (!open) {
    return (
      <div className="bd-strow">
        <div className="bd-strowtext">
          <span className="bd-strowk">Password</span>
          <span className="bd-strown">
            {done
              ? 'Password changed. Other sessions were signed out.'
              : 'Changing it signs out every other session.'}
          </span>
        </div>
        <button
          type="button"
          className="bd-btn bd-btn--ghost bd-stbtn"
          onClick={() => {
            setDone(false);
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      className="bd-strow bd-strow--form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="bd-strowtext">
        <label className="bd-strowk" htmlFor="st-current">
          Current password
        </label>
        <input
          id="st-current"
          className="bd-stinput"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoFocus
        />
        <label className="bd-strowk" htmlFor="st-next">
          New password
        </label>
        <input
          id="st-next"
          className="bd-stinput"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        {error ? <span className="bd-sterror">{error}</span> : null}
      </div>
      <div className="bd-stformacts">
        <button
          type="button"
          className="bd-btn bd-btn--ghost bd-stbtn"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="bd-btn bd-btn--primary bd-stbtn"
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
