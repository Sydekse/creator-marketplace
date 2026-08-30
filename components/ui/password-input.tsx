'use client';

import * as React from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A password field with a show/hide toggle. Wraps the shared `Input` so it
 * inherits the same focus ring and `aria-invalid` styling every other field
 * uses — the only additions are the reveal button and the padding that keeps
 * the value clear of it. The toggle is a real, focusable control (screen
 * readers announce its pressed state) but stays out of the form's submit path
 * via `type="button"`.
 */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-9', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-neutral-600 transition-colors duration-300 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-brand"
      >
        {visible ? (
          <EyeSlash className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
