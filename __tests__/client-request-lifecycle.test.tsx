import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { CreatorCredentialsForm } from '@/app/(creator)/creator/credentials/credentials-form';
import {
  RevokeOthersButton,
  RevokeSessionButton,
} from '@/app/settings/session-actions';
import { MarkReadButton } from '@/app/notifications/mark-read-button';
import { NotificationToaster } from '@/components/notifications/notification-toaster';

// Exercise the real component handlers/effects in the existing Node runner:
// retain hook slots between renders without adding a DOM/test-renderer package.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  cleanups: new Map<number, () => void>(),
}));
const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn() },
  pathname: '/creator',
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    custom: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
  },
  revokeSession: vi.fn(),
  revokeOthers: vi.fn(),
}));
const documentState = { hidden: false };
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === 'function' ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (
      previous &&
      previous.length === deps.length &&
      previous.every((value, i) => Object.is(value, deps[i]))
    ) {
      return;
    }
    hooks.slots[index] = deps;
    hooks.effects.push(() => {
      hooks.cleanups.get(index)?.();
      hooks.cleanups.delete(index);
      const cleanup = effect();
      if (cleanup) hooks.cleanups.set(index, cleanup);
    });
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    revokeSession: mocks.revokeSession,
    revokeOtherSessions: mocks.revokeOthers,
  },
}));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/input', () => ({ Input: 'input' }));
vi.mock('@/components/ui/password-input', () => ({ PasswordInput: 'input' }));
vi.mock('@/components/brand/tiktok-icon', () => ({ TikTokIcon: 'svg' }));

type Props = {
  children?: ReactNode;
  id?: string;
  type?: string;
  disabled?: boolean;
  message?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: (event?: unknown) => unknown;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
};
type Element = ReactElement<Props>;

function render<T>(component: () => T): T {
  hooks.cursor = 0;
  const result = component();
  hooks.effects.splice(0).forEach((effect) => effect());
  return result;
}

function unmount() {
  hooks.cleanups.forEach((cleanup) => cleanup());
  hooks.cleanups.clear();
}

function find(tree: ReactNode, predicate: (node: Element) => boolean): Element {
  const queue: ReactNode[] = [tree];
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
    } else if (isValidElement<Props>(node)) {
      if (predicate(node)) return node;
      queue.push(node.props.children);
    }
  }
  throw new Error('Element not found');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.resetAllMocks();
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.effects = [];
  mocks.pathname = '/creator';
  documentState.hidden = false;
  vi.stubGlobal('document', documentState);
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('credential final save recovery', () => {
  function form(needsEmail = false, hasPassword = false) {
    return render(() => CreatorCredentialsForm({ needsEmail, hasPassword }));
  }
  function change(tree: ReactNode, id: string, value: string) {
    find(tree, (node) => node.props.id === id).props.onChange!({
      target: { value },
    });
  }
  function passwordReady() {
    const tree = form();
    change(tree, 'credentials-password', 'strong-password');
    change(tree, 'credentials-confirm', 'strong-password');
    return form();
  }
  function submit(tree: Element) {
    return tree.props.onSubmit!({ preventDefault: vi.fn() });
  }
  function busy(tree: ReactNode) {
    return find(tree, (node) => node.props.type === 'submit').props.disabled;
  }

  it('handles a network rejection, restores loading, and allows a successful retry', async () => {
    const request = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(request.promise);
    vi.stubGlobal('fetch', fetchMock);
    const pending = submit(passwordReady());
    expect(busy(form())).toBe(true);
    request.reject(new TypeError('offline'));
    await pending;
    expect(busy(form())).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Could not reach the server. Check your connection.'
    );
    expect(mocks.router.push).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await submit(form());
    expect(busy(form())).toBe(false);
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    expect(mocks.router.push).toHaveBeenCalledWith('/creator/onboarding');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      password: 'strong-password',
    });
  });

  it.each([
    {
      body: { error: { details: { password: ['Password was rejected.'] } } },
      message: 'Password was rejected.',
    },
    {
      body: { error: { message: 'Could not save changes.' } },
      message: 'Could not save changes.',
    },
    { body: null, message: 'Could not save. Please try again.' },
  ])(
    'announces HTTP failure $message and restores loading',
    async ({ body, message }) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            body === null
              ? new Response('not JSON', { status: 500 })
              : Response.json(body, { status: 400 })
          )
      );
      await submit(passwordReady());
      expect(busy(form())).toBe(false);
      expect(mocks.toast.error).toHaveBeenCalledWith(message);
      expect(mocks.router.refresh).not.toHaveBeenCalled();
      if (body?.error && 'details' in body.error) {
        expect(
          find(form(), (node) => node.props.id === 'credentials-password-error')
            .props.message
        ).toBe(message);
      }
    }
  );

  it('keeps send/verify OTP payloads and announces a hidden code error on final save', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: { details: { code: ['This code has expired.'] } },
          },
          { status: 400 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    change(form(true), 'credentials-email', 'creator@example.test');
    await submit(form(true));
    change(form(true), 'credentials-code', '123456');
    await submit(form(true));
    const passwordStep = form(true);
    change(passwordStep, 'credentials-password', 'strong-password');
    change(passwordStep, 'credentials-confirm', 'strong-password');
    await submit(form(true));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/creators/credentials/otp',
      '/api/creators/credentials/otp/verify',
      '/api/creators/credentials',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      email: 'creator@example.test',
      code: '123456',
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      email: 'creator@example.test',
      code: '123456',
      password: 'strong-password',
    });
    expect(mocks.toast.error).toHaveBeenCalledWith('This code has expired.');
    expect(busy(form(true))).toBe(false);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('still verifies OTP before an email-only final save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    change(form(true, true), 'credentials-email', 'creator@example.test');
    await submit(form(true, true));
    change(form(true, true), 'credentials-code', '654321');
    await submit(form(true, true));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      email: 'creator@example.test',
      code: '654321',
    });
    expect(mocks.router.push).toHaveBeenCalledWith('/creator/onboarding');
  });

  it('retains email and OTP after a final-save network failure and verifies again on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    change(form(true, true), 'credentials-email', 'creator@example.test');
    await submit(form(true, true));
    change(form(true, true), 'credentials-code', '654321');
    await submit(form(true, true));
    expect(busy(form(true, true))).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Could not reach the server. Check your connection.'
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
    await submit(form(true, true));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/creators/credentials/otp',
      '/api/creators/credentials/otp/verify',
      '/api/creators/credentials',
      '/api/creators/credentials/otp/verify',
      '/api/creators/credentials',
    ]);
    for (const [, options] of fetchMock.mock.calls.slice(1)) {
      expect(JSON.parse(options.body)).toEqual({
        email: 'creator@example.test',
        code: '654321',
      });
    }
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    expect(mocks.router.push).toHaveBeenCalledWith('/creator/onboarding');
  });
});

describe.each(['single', 'others'] as const)(
  '%s session revocation',
  (kind) => {
    const component = () =>
      kind === 'single'
        ? RevokeSessionButton({ token: 'other-device-token' })
        : RevokeOthersButton();
    const action = () =>
      kind === 'single' ? mocks.revokeSession : mocks.revokeOthers;

    it('shows a fallback for returned errors without messages and blocks another pending action', async () => {
      const request = deferred<{ error: { status: number } }>();
      action().mockReturnValueOnce(request.promise);
      render(component).props.onClick();
      render(component).props.onClick();
      expect(action()).toHaveBeenCalledOnce();
      request.resolve({ error: { status: 500 } });
      await flush();
      expect(render(component).props.disabled).toBe(false);
      expect(mocks.toast.error).toHaveBeenCalledWith(
        kind === 'single'
          ? 'Could not sign out. Please try again.'
          : 'Could not sign out other sessions. Please try again.'
      );
      expect(mocks.router.refresh).not.toHaveBeenCalled();
    });

    it.each(['returned', 'thrown'] as const)(
      'recovers from %s errors and retries',
      async (failure) => {
        if (failure === 'returned') {
          action().mockResolvedValueOnce({
            error: { message: 'Session expired.' },
          });
        } else {
          action().mockRejectedValueOnce(new Error('offline'));
        }
        render(component).props.onClick();
        expect(render(component).props.disabled).toBe(true);
        await flush();
        expect(render(component).props.disabled).toBe(false);
        expect(mocks.toast.error).toHaveBeenCalledOnce();
        if (failure === 'returned') {
          expect(mocks.toast.error).toHaveBeenCalledWith('Session expired.');
        }
        expect(mocks.router.refresh).not.toHaveBeenCalled();
        action().mockResolvedValueOnce({ data: { status: true }, error: null });
        render(component).props.onClick();
        await flush();
        expect(render(component).props.disabled).toBe(false);
        expect(mocks.router.refresh).toHaveBeenCalledOnce();
        expect(mocks.router.push).not.toHaveBeenCalled();
        if (kind === 'single') {
          expect(mocks.revokeSession).toHaveBeenLastCalledWith({
            token: 'other-device-token',
          });
          expect(mocks.revokeOthers).not.toHaveBeenCalled();
        } else {
          expect(mocks.revokeOthers).toHaveBeenLastCalledWith();
          expect(mocks.revokeSession).not.toHaveBeenCalled();
        }
      }
    );
  }
);

describe('mark-read server-row optimism', () => {
  function fixture() {
    const classes = new Set(['bd-ntrow', 'bd-ntrow--new']);
    const marker = { hidden: false };
    const row = {
      classList: {
        contains: (name: string) => classes.has(name),
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
      querySelector: vi.fn(() => marker),
    };
    const event = { currentTarget: { closest: vi.fn(() => row) } };
    const component = () =>
      MarkReadButton({ notificationId: 'notification-1' });
    return { classes, marker, event, component };
  }

  it.each(['http', 'network'] as const)(
    'rolls back %s failure without relying on refresh remounts',
    async (failure) => {
      const { classes, marker, event, component } = fixture();
      const request = deferred<Response>();
      const fetchMock = vi.fn().mockReturnValueOnce(request.promise);
      vi.stubGlobal('fetch', fetchMock);
      const button = render(component)!;
      const pending = button.props.onClick(event);
      await button.props.onClick(event);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(render(component)).toBeNull();
      expect(classes.has('bd-ntrow--new')).toBe(false);
      expect(marker.hidden).toBe(true);
      if (failure === 'http')
        request.resolve(new Response(null, { status: 500 }));
      else request.reject(new Error('offline'));
      await pending;
      expect(classes.has('bd-ntrow--new')).toBe(true);
      expect(classes.has('bd-ntrow')).toBe(true);
      expect(marker.hidden).toBe(false);
      expect(render(component)).not.toBeNull();
      expect(mocks.router.refresh).toHaveBeenCalledOnce();
      expect(mocks.toast.error).toHaveBeenCalledOnce();

      fetchMock.mockResolvedValueOnce(Response.json({ updated: true }));
      await render(component)!.props.onClick(event);
      expect(render(component)).toBeNull();
      expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
        notificationId: 'notification-1',
      });
    }
  );

  it.each([true, false])(
    'does not refresh or report late completion after unmount (ok=%s)',
    async (ok) => {
      const { event, component } = fixture();
      const request = deferred<Response>();
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(request.promise));
      const pending = render(component)!.props.onClick(event);
      unmount();
      request.resolve(new Response(null, { status: ok ? 200 : 500 }));
      await pending;
      expect(mocks.router.refresh).not.toHaveBeenCalled();
      expect(mocks.toast.error).not.toHaveBeenCalled();
    }
  );
});

describe('notification polling lifecycle', () => {
  const row = (id = 'notification-1') => ({
    id,
    type: 'offer_received',
    payload: {},
    readAt: null,
    createdAt: '2026-09-06T00:01:00.000Z',
  });
  const component = () => NotificationToaster({ role: 'creator' });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
  });

  it('never overlaps requests or response-body reads and never duplicates a toast', async () => {
    const request = deferred<Response>();
    const body = deferred<{ notifications: ReturnType<typeof row>[] }>();
    const fetchMock = vi.fn().mockReturnValueOnce(request.promise);
    vi.stubGlobal('fetch', fetchMock);
    render(component);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    request.resolve({ ok: true, json: () => body.promise } as Response);
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    body.resolve({ notifications: [row(), row()] });
    await flush();
    expect(mocks.toast.custom).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValue(Response.json({ notifications: [row()] }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.toast.custom).toHaveBeenCalledOnce();
  });

  it('preserves seen-ID deduplication after dismissal and frees capacity for a new notification', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ notifications: [row()] }));
    vi.stubGlobal('fetch', fetchMock);
    render(component);
    await vi.advanceTimersByTimeAsync(60_000);
    const [, options] = mocks.toast.custom.mock.calls[0] as unknown as [
      unknown,
      { onDismiss: () => void },
    ];
    options.onDismiss();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        notifications: [
          { ...row(), createdAt: '2026-09-06T00:02:00.000Z' },
          { ...row('new-arrival'), createdAt: '2026-09-06T00:02:00.000Z' },
        ],
      })
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.toast.custom).toHaveBeenCalledTimes(2);
  });

  it.each(['hidden', 'feed'] as const)(
    'suppresses late body data while %s without advancing the watermark',
    async (reason) => {
      const body = deferred<{ notifications: ReturnType<typeof row>[] }>();
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => body.promise,
      });
      vi.stubGlobal('fetch', fetchMock);
      render(component);
      await vi.advanceTimersByTimeAsync(60_000);
      if (reason === 'hidden') documentState.hidden = true;
      else {
        mocks.pathname = '/notifications';
        render(component);
      }
      body.resolve({ notifications: [row()] });
      await flush();
      expect(mocks.toast.custom).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      if (reason === 'hidden') documentState.hidden = false;
      else {
        mocks.pathname = '/creator';
        render(component);
      }
      fetchMock.mockResolvedValue(Response.json({ notifications: [row()] }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.toast.custom).toHaveBeenCalledOnce();
    }
  );

  it.each(['hidden', 'feed', 'unmounted'] as const)(
    'rechecks %s after fetch before reading the response body',
    async (reason) => {
      const request = deferred<Response>();
      const json = vi.fn().mockResolvedValue({ notifications: [row()] });
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(request.promise));
      render(component);
      await vi.advanceTimersByTimeAsync(60_000);
      if (reason === 'hidden') documentState.hidden = true;
      else if (reason === 'feed') {
        mocks.pathname = '/notifications';
        render(component);
      } else unmount();
      request.resolve({ ok: true, json } as unknown as Response);
      await flush();
      expect(json).not.toHaveBeenCalled();
      expect(mocks.toast.custom).not.toHaveBeenCalled();
    }
  );

  it('retains actionable, unread, arrival-time filtering and toast navigation', async () => {
    const notifications = [
      { ...row('already-read'), readAt: '2026-09-06T00:01:05.000Z' },
      { ...row('backlog'), createdAt: '2026-09-05T00:00:00.000Z' },
      { ...row('not-actionable'), type: 'offer_accepted' },
      row('actionable'),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ notifications }));
    vi.stubGlobal('fetch', fetchMock);
    render(component);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.toast.custom).toHaveBeenCalledOnce();
    const [content] = vi.mocked(mocks.toast.custom).mock
      .calls[0] as unknown as [() => Element];
    fetchMock.mockResolvedValueOnce(Response.json({ updated: true }));
    content().props.onClick!();
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/notifications/read',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({ notificationId: 'actionable' }),
      })
    );
    expect(mocks.toast.dismiss).toHaveBeenCalledOnce();
    expect(mocks.router.push).toHaveBeenCalledOnce();
  });

  it('aborts cleanup and ignores late body resolution even if transport ignores abort', async () => {
    const body = deferred<{ notifications: ReturnType<typeof row>[] }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => body.promise });
    vi.stubGlobal('fetch', fetchMock);
    render(component);
    await vi.advanceTimersByTimeAsync(60_000);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    body.resolve({ notifications: [row()] });
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.toast.custom).not.toHaveBeenCalled();
  });

  it('releases the in-flight guard after failed polls and respects the two-toast limit', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response('malformed'))
      .mockResolvedValueOnce(
        Response.json({
          notifications: [row('one'), row('two'), row('three')],
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    render(component);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mocks.toast.custom).toHaveBeenCalledTimes(2);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it('never polls the feed, hidden documents, or admin accounts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.pathname = '/notifications';
    render(component);
    await vi.advanceTimersByTimeAsync(60_000);
    mocks.pathname = '/creator';
    documentState.hidden = true;
    render(component);
    await vi.advanceTimersByTimeAsync(60_000);
    documentState.hidden = false;
    render(() => NotificationToaster({ role: 'admin' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
