'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { authClient } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import type { CurrentUser } from '@/lib/auth';

interface UserMenuProps {
  user: CurrentUser;
}

const ROLE_LABEL: Record<string, string> = {
  brand: 'Brand workspace',
  creator: 'Creator workspace',
  admin: 'Admin console',
};

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const displayName = user.name ?? user.email;
  // Sign-out asks twice: the first press arms the confirm row, the second
  // performs it. Arming resets when the menu closes; while signing out the
  // menu stays open showing the spinner until the redirect lands.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await authClient.signOut();
      router.push('/');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open && !busy) setConfirming(false);
      }}
    >
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900">
        <InitialsAvatar
          name={displayName}
          image={user.image}
          className="size-9 cursor-pointer rounded-full border border-neutral-50/20 bg-neutral-50 text-[11px] text-neutral-900 shadow-none transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 rounded-2xl border-neutral-800 bg-neutral-900 p-0 text-neutral-50 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.55)]"
      >
        {/*
          Base UI's GroupLabel reads group context to wire up `aria-labelledby`
          and throws outright without a Group ancestor. The Group wraps the items
          as well as the label, so the label is describing something rather than
          heading an empty group.
        */}
        <DropdownMenuGroup>
          {/* The identity cell: the nav pill unfolding into an ink rail-card —
              same dark ground as the header it hangs from, the workspace as a
              teal eyebrow over the name, the address in mono. */}
          <DropdownMenuLabel className="flex items-center gap-3 border-b border-neutral-50/10 px-4 pt-4 pb-3.5">
            <InitialsAvatar
              name={displayName}
              image={user.image}
              size="lg"
              className="rounded-full border border-neutral-50/20 bg-neutral-50 text-[15px] text-neutral-900"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[oklch(0.82_0.07_185)]">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
              <span className="mt-0.5 truncate text-sm font-semibold text-neutral-50">
                {user.name ?? 'User'}
              </span>
              <span className="truncate font-mono text-[11px] font-normal text-neutral-400">
                {user.email}
              </span>
            </span>
          </DropdownMenuLabel>

          <div className="p-1.5">
            {/*
              `onClick`, not `onSelect`. Base UI's Menu.Item has no `onSelect`, and
              React would bind the DOM text-selection event of that name instead —
              leaving the action silently inert.
            */}
            <DropdownMenuItem
              className="group/uitem rounded-lg px-2.5 py-2 text-neutral-300 focus:bg-neutral-800 focus:text-neutral-50"
              onClick={() => router.push('/settings')}
            >
              Settings
              <span
                aria-hidden="true"
                className="ml-auto text-neutral-500 transition-transform duration-200 group-focus/uitem:translate-x-0.5 group-focus/uitem:text-[oklch(0.82_0.07_185)]"
              >
                →
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="group/uitem rounded-lg px-2.5 py-2 text-neutral-300 focus:bg-neutral-800 focus:text-neutral-50"
              onClick={() => router.push('/notifications')}
            >
              Notifications
              <span
                aria-hidden="true"
                className="ml-auto text-neutral-500 transition-transform duration-200 group-focus/uitem:translate-x-0.5 group-focus/uitem:text-[oklch(0.82_0.07_185)]"
              >
                →
              </span>
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="my-0 bg-neutral-50/10" />

          <div className="p-1.5">
            {busy ? (
              <div
                className="flex items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-sm text-neutral-400"
                role="status"
              >
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-neutral-700 border-t-[oklch(0.82_0.07_185)]"
                />
                Signing out…
              </div>
            ) : confirming ? (
              <div className="flex items-center gap-1.5">
                <DropdownMenuItem
                  closeOnClick={false}
                  className="flex-1 justify-center rounded-lg bg-[oklch(0.32_0.1_25)] px-2.5 py-2 font-medium text-[oklch(0.92_0.03_25)] focus:bg-[oklch(0.38_0.11_25)] focus:text-[oklch(0.95_0.02_25)]"
                  onClick={handleSignOut}
                >
                  Confirm sign out
                </DropdownMenuItem>
                <DropdownMenuItem
                  closeOnClick={false}
                  className="justify-center rounded-lg px-2.5 py-2 text-neutral-300 focus:bg-neutral-800 focus:text-neutral-50"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </DropdownMenuItem>
              </div>
            ) : (
              <DropdownMenuItem
                closeOnClick={false}
                className="rounded-lg px-2.5 py-2 text-neutral-300 focus:bg-neutral-800 focus:text-neutral-50"
                onClick={() => setConfirming(true)}
              >
                Sign out
              </DropdownMenuItem>
            )}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
