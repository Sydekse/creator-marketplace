'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/**
 * Display-name row: reads as a fact, edits in place. Better Auth's
 * `updateUser` owns the write; `router.refresh()` re-renders the page (and
 * the header avatar) from the session's new truth.
 */
export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Name cannot be empty.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.updateUser({ name: trimmed });
    setBusy(false);
    if (err) {
      setError(err.message ?? 'Could not save the name.');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="bd-strow">
        <div className="bd-strowtext">
          <span className="bd-strowk">Display name</span>
          <span className="bd-strowv">{initialName || 'Not set'}</span>
        </div>
        <button
          type="button"
          className="bd-btn bd-btn--ghost bd-stbtn"
          onClick={() => {
            setName(initialName);
            setEditing(true);
          }}
        >
          Edit
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
        <label className="bd-strowk" htmlFor="st-name">
          Display name
        </label>
        <input
          id="st-name"
          className="bd-stinput"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          autoFocus
        />
        {error ? <span className="bd-sterror">{error}</span> : null}
      </div>
      <div className="bd-stformacts">
        <button
          type="button"
          className="bd-btn bd-btn--ghost bd-stbtn"
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="bd-btn bd-btn--primary bd-stbtn"
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
