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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { authClient } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import type { CurrentUser } from '@/lib/auth';

interface UserMenuProps {
  user: CurrentUser;
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();
  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none">
        <Avatar className="h-8 w-8 cursor-pointer">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
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
