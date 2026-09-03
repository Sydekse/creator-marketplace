'use client';

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

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const displayName = user.name ?? user.email;
  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-neutral-50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900">
        <InitialsAvatar
          name={displayName}
          image={user.image}
          className="size-8 cursor-pointer border-neutral-50/20 bg-neutral-50 text-[11px] text-neutral-900 shadow-none transition-transform duration-300 ease-out hover:scale-105 active:scale-95"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/*
          Base UI's GroupLabel reads group context to wire up `aria-labelledby`
          and throws outright without a Group ancestor. The Group wraps the items
          as well as the label, so the label is describing something rather than
          heading an empty group.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{user.name ?? 'User'}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {roleLabel}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            `onClick`, not `onSelect`. Base UI's Menu.Item has no `onSelect`, and
            React would bind the DOM text-selection event of that name instead —
            leaving sign-out silently inert.
          */}
          <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
