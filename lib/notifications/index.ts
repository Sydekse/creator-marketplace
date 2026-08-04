/**
 * Notification service (KAN-54, Tech Spec §5).
 *
 * Import from here, not from the individual modules — `notify` and
 * `withNotifications` are the intended surface, and the split behind them is
 * free to change.
 */

export { notify, notifyWith, withNotifications } from './notify';
export type { Notify, NotifyDeps } from './notify';

export { NOTIFICATION_TYPES, EmailDeliveryError } from './types';
export type {
  EmailMessage,
  EmailProvider,
  EmailSendResult,
  NotificationInput,
  NotificationPayloadMap,
  NotificationType,
} from './types';

export { renderNotification, formatEtb } from './templates';

export {
  ConsoleEmailProvider,
  InMemoryEmailProvider,
  RedirectingEmailProvider,
  ResendEmailProvider,
  providerFromEnv,
} from './providers';

export { dispatchWithRetry, RETRY_BACKOFF_MS } from './dispatch';
export type { DispatchLog, DispatchOutcome } from './dispatch';

export { redactEmail } from './redact';
