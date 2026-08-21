import { cn } from '@/lib/utils';

/**
 * The inline error line under a form field. Rendered only when there is a
 * message, so callers can drop it in unconditionally: `<FieldError id={…}
 * message={errors.email} />`. The `id` is what the field's `aria-describedby`
 * points at, and `role="alert"` is what makes a screen reader announce the
 * message the moment validation fills it in.
 */
function FieldError({
  id,
  message,
  className,
}: {
  id: string;
  message?: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn('text-[13px] leading-snug text-destructive', className)}
    >
      {message}
    </p>
  );
}

export { FieldError };
