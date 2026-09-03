'use client';

import { useState } from 'react';
import {
  EMAIL_PREF_COPY,
  EMAIL_PREF_KEYS,
} from '@/lib/notifications/prefs-shared';
import type {
  EmailPrefKey,
  EmailPrefs,
} from '@/lib/notifications/prefs-shared';

/**
 * Email category toggles, optimistic: the switch flips on press and reverts
 * only if the PATCH fails. Muting stops the email copy only — the in-app
 * feed and bell always carry everything, which the chapter's ruler says.
 */
export function PrefToggles({ initial }: { initial: EmailPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [failed, setFailed] = useState<string | null>(null);

  async function flip(key: EmailPrefKey) {
    const nextValue = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: nextValue }));
    setFailed(null);
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: nextValue }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      setPrefs((p) => ({ ...p, [key]: !nextValue }));
      setFailed('Could not save that change. Try again.');
    }
  }

  return (
    <div className="bd-stprefs">
      {EMAIL_PREF_KEYS.map((key) => {
        const on = prefs[key];
        return (
          <div key={key} className="bd-strow">
            <div className="bd-strowtext">
              <span className="bd-strowk">{EMAIL_PREF_COPY[key].label}</span>
              <span className="bd-strown">{EMAIL_PREF_COPY[key].detail}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`Email for ${EMAIL_PREF_COPY[key].label}`}
              className="bd-stswitch"
              data-on={on || undefined}
              onClick={() => void flip(key)}
            >
              <span className="bd-stknob" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {failed ? <p className="bd-sterror">{failed}</p> : null}
    </div>
  );
}
