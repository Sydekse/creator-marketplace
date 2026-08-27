import { cn } from '@/lib/utils';

function Bone({ className }: { className?: string }) {
  return <div className={cn('bone-shimmer rounded-md', className)} />;
}

/** Same shell as `PageHeader`. */
function PageHeaderSkeleton({
  action,
  titleClass = 'h-10 w-[min(100%,18rem)]',
}: {
  action?: boolean;
  titleClass?: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      <Bone className="bone-shimmer-tint h-[13px] w-28 rounded-full" />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Bone className={cn('rounded-lg', titleClass)} />
        {action ? <Bone className="h-10 w-36 rounded-full" /> : null}
      </div>
      <Bone className="bone-shimmer-soft h-4 max-w-[52ch]" />
      <div className="mt-1 border-b border-neutral-200" aria-hidden />
    </header>
  );
}

export function WorkspacePageSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton />
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {['a', 'b', 'c', 'd'].map((key) => (
          <li key={key} className="flex items-center gap-3 py-4">
            <Bone className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Bone className="h-3.5 w-40 max-w-full" />
              <Bone className="bone-shimmer-soft h-3 w-24" />
            </div>
            <Bone className="h-3.5 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DiscoverSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-4">
      <header className="flex flex-col gap-3">
        <Bone className="bone-shimmer-tint h-[13px] w-36 rounded-full" />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <Bone className="h-10 w-[min(100%,16rem)] rounded-lg" />
          <Bone className="h-[42px] w-48 rounded-full" />
        </div>
        <Bone className="bone-shimmer-soft h-4 max-w-[52ch]" />
        <div className="mt-1 border-b border-neutral-200" aria-hidden />
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex flex-col gap-5 border-y border-neutral-200 bg-neutral-100/45 px-4 py-5 sm:px-5 lg:sticky lg:top-20">
          <div className="border-b border-neutral-200 pb-3">
            <Bone className="bone-shimmer-tint h-3 w-28 rounded-full" />
            <Bone className="bone-shimmer-soft mt-1 h-4 w-40" />
          </div>
          <div className="flex flex-col gap-4">
            <Bone className="h-11 rounded-lg" />
            <Bone className="h-11 rounded-lg" />
            <Bone className="h-11 rounded-lg" />
            <Bone className="h-11 rounded-lg" />
            <Bone className="h-11 rounded-lg" />
          </div>
          <div className="flex items-center gap-3">
            <Bone className="h-8 w-28 rounded-full" />
            <Bone className="h-8 w-16 rounded-full" />
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {['a', 'b', 'c', 'd'].map((key) => (
            <li
              key={key}
              className="relative flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 py-5"
            >
              <div className="px-5 pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Bone className="size-8 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Bone className="h-4 w-28" />
                      <Bone className="bone-shimmer-soft h-3 w-16" />
                    </div>
                  </div>
                  <Bone className="bone-shimmer-tint h-3 w-10 rounded-full" />
                </div>
              </div>
              <div className="px-5">
                <div className="grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 py-3">
                  <Bone className="mx-2 h-8" />
                  <Bone className="mx-2 h-8" />
                  <Bone className="mx-2 h-8" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CreatorDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Bone className="h-5 w-32" />
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <Bone className="size-16 shrink-0 rounded-full sm:size-20" />
            <div className="flex min-w-0 flex-col gap-3">
              <Bone className="bone-shimmer-tint h-[13px] w-16 rounded-full" />
              <Bone className="h-10 w-[min(100%,16rem)] rounded-lg" />
              <Bone className="bone-shimmer-soft h-4 w-40" />
              <Bone className="mt-1 h-9 w-36 rounded-full" />
            </div>
          </header>
          <dl className="grid grid-cols-1 divide-y divide-neutral-200 border-y border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-0 py-5 sm:px-5 sm:first:pl-0">
              <Bone className="h-3 w-16" />
              <Bone className="mt-2 h-8 w-24" />
            </div>
            <div className="px-0 py-5 sm:px-5">
              <Bone className="h-3 w-20" />
              <Bone className="mt-2 h-8 w-20" />
            </div>
            <div className="px-0 py-5 sm:px-5 sm:last:pr-0">
              <Bone className="h-3 w-12" />
              <Bone className="mt-2 h-8 w-28" />
            </div>
          </dl>
        </div>
        <div className="bone-shimmer-ink h-72 rounded-[24px]" />
      </div>
    </div>
  );
}

export function CampaignDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Bone className="h-9 w-44 rounded-full" />
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-5">
            <Bone className="bone-shimmer-tint h-[13px] w-24 rounded-full" />
            <Bone className="h-10 w-[min(100%,18ch)] rounded-lg" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Bone className="h-6 w-16 rounded-full" />
              <Bone className="bone-shimmer-soft h-4 w-28" />
              <Bone className="h-4 w-16" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Bone className="h-8 w-24 rounded-full" />
              <Bone className="h-8 w-28 rounded-full" />
              <Bone className="h-8 w-28 rounded-full" />
            </div>
            <div className="border-b border-neutral-200" aria-hidden />
          </header>
          <Bone className="bone-shimmer-tint h-[13px] w-20 rounded-full" />
          <div className="overflow-x-auto">
            <div className="min-w-[42rem]">
              <div className="grid grid-cols-[2rem_1.75rem_minmax(0,1fr)_7rem_3.5rem_7.5rem_auto] items-center gap-x-3 border-b border-neutral-200 px-1 py-2">
                <span />
                <span />
                <Bone className="h-3 w-16" />
                <Bone className="ml-auto h-3 w-10" />
                <Bone className="ml-auto h-3 w-12" />
                <Bone className="ml-auto h-3 w-10" />
                <span />
              </div>
              <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
                {['a', 'b', 'c'].map((key) => (
                  <li
                    key={key}
                    className="grid grid-cols-[2rem_1.75rem_minmax(0,1fr)_7rem_3.5rem_7.5rem_auto] items-center gap-x-3 px-1 py-3"
                  >
                    <Bone className="h-3 w-5" />
                    <Bone className="size-6 rounded-full" />
                    <Bone className="h-4 w-32 max-w-full" />
                    <Bone className="ml-auto h-4 w-16" />
                    <Bone className="ml-auto h-4 w-8" />
                    <Bone className="ml-auto h-4 w-16" />
                    <Bone className="h-8 w-16 rounded-full" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <aside className="lg:sticky lg:top-24">
          <div className="bone-shimmer-ink h-[22rem] rounded-[24px] p-6 sm:p-8" />
        </aside>
      </div>
    </div>
  );
}

export function DealDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-4">
      <Bone className="h-9 w-44 rounded-full" />
      <div className="flex items-start gap-5">
        <Bone className="size-12 shrink-0 rounded-full" />
        <header className="flex min-w-0 flex-1 flex-col gap-3">
          <Bone className="bone-shimmer-tint h-[13px] w-12 rounded-full" />
          <Bone className="h-10 w-[min(100%,16rem)] rounded-lg" />
          <Bone className="h-6 w-24 rounded-full" />
          <div className="mt-1 border-b border-neutral-200" aria-hidden />
        </header>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-neutral-200 py-6 sm:grid-cols-3">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <Bone className="h-3 w-16" />
            <Bone className="h-4 w-24" />
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-4">
        <Bone className="h-4 w-28" />
        <Bone className="h-28 rounded-[20px]" />
        <Bone className="h-28 rounded-[20px]" />
      </div>
    </div>
  );
}

export function BrandDashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 py-4">
      <PageHeaderSkeleton action titleClass="h-10 w-[min(100%,16rem)]" />
      <section className="rounded-[28px] border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
        <Bone className="bone-shimmer-tint h-[13px] w-24 rounded-full" />
        <Bone className="mt-3 h-4 w-40" />
      </section>
      <section className="rounded-[28px] bg-neutral-900 p-6 sm:p-8">
        <Bone className="h-[13px] w-16 rounded-full bg-neutral-700" />
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Bone className="h-12 bg-neutral-800" />
          <Bone className="h-12 bg-neutral-800" />
          <Bone className="h-12 bg-neutral-800" />
        </dl>
      </section>
      <section className="border-t border-neutral-200 pt-8">
        <Bone className="bone-shimmer-tint h-[13px] w-32 rounded-full" />
        <ul className="mt-5 divide-y divide-neutral-200 border-y border-neutral-200">
          {['a', 'b'].map((key) => (
            <li
              key={key}
              className="flex items-center justify-between gap-4 px-2 py-4 sm:px-4"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Bone className="size-6 rounded-full" />
                <Bone className="h-4 w-28" />
              </div>
              <Bone className="h-4 w-16" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function CreatorDashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 py-4">
      <Bone className="h-24 rounded-[28px]" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-start lg:gap-12">
        <div className="flex flex-col gap-8">
          <section className="rounded-[28px] border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
            <Bone className="bone-shimmer-tint h-[13px] w-20 rounded-full" />
            <Bone className="mt-4 h-10 w-40" />
          </section>
          <section className="rounded-[28px] border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
            <Bone className="h-4 w-24" />
            <ul className="mt-4 divide-y divide-neutral-200">
              {['a', 'b', 'c'].map((key) => (
                <li
                  key={key}
                  className="flex items-center justify-between py-4"
                >
                  <Bone className="h-4 w-36" />
                  <Bone className="h-4 w-16" />
                </li>
              ))}
            </ul>
          </section>
        </div>
        <Bone className="h-72 rounded-[28px] border border-neutral-200" />
      </div>
    </div>
  );
}

export function AdminTableSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeaderSkeleton titleClass="h-10 w-[min(100%,16rem)]" />
      <div className="flex items-center justify-between gap-4 border-y border-neutral-200 bg-neutral-100/45 px-4 py-3">
        <Bone className="bone-shimmer-tint h-3 w-28 rounded-full" />
        <Bone className="h-3 w-24" />
      </div>
      <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <li key={key} className="flex items-center gap-3 px-1 py-5 sm:px-4">
            <Bone className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Bone className="h-4 w-40 max-w-full" />
              <Bone className="bone-shimmer-soft h-3 w-48 max-w-full" />
            </div>
            <Bone className="h-8 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <PageHeaderSkeleton titleClass="h-10 w-[min(100%,14rem)]" />
      <section>
        <div className="mb-4 flex flex-col gap-1">
          <Bone className="bone-shimmer-tint h-[13px] w-40 rounded-full" />
          <Bone className="bone-shimmer-soft h-4 w-64 max-w-full" />
        </div>
        <div className="grid border-y border-neutral-200 lg:grid-cols-[1.15fr_0.85fr]">
          {['a', 'b', 'c', 'd'].map((key) => (
            <div
              key={key}
              className="flex min-h-40 flex-col gap-6 border-b border-neutral-200 p-6"
            >
              <Bone className="size-8 rounded-lg" />
              <Bone className="h-5 w-40" />
              <Bone className="bone-shimmer-soft h-4 w-52 max-w-full" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function NotificationsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeaderSkeleton titleClass="h-10 w-[min(100%,14rem)]" />
      <ul className="border-t border-neutral-200">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <li
            key={key}
            className="border-b border-neutral-200 px-1 py-5 sm:px-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Bone className="size-6 rounded-full" />
              <Bone className="h-6 w-24 rounded-full" />
              <Bone className="bone-shimmer-soft h-3 w-28" />
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Bone className="h-4 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CampaignListSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton action titleClass="h-10 w-[min(100%,12rem)]" />
      <section className="border-y border-neutral-200">
        <div className="flex items-center justify-between gap-4 bg-neutral-100/45 px-4 py-3 sm:px-5">
          <Bone className="bone-shimmer-tint h-3 w-32 rounded-full" />
          <Bone className="h-3 w-20" />
        </div>
        <ul>
          {['a', 'b', 'c', 'd'].map((key) => (
            <li key={key} className="border-b border-neutral-200">
              <div className="grid gap-5 px-1 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <Bone className="h-4 w-48 max-w-full" />
                    <Bone className="h-6 w-16 shrink-0 rounded-full" />
                  </div>
                  <Bone className="bone-shimmer-soft mt-1 h-3 w-36" />
                </div>
                <Bone className="h-4 w-20" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function DealInboxSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 py-4">
      <PageHeaderSkeleton titleClass="h-10 w-[min(100%,14rem)]" />
      <ul className="border-y border-neutral-200">
        {['a', 'b', 'c', 'd'].map((key) => (
          <li key={key} className="border-b border-neutral-200 last:border-b-0">
            <div className="flex min-h-20 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-3 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Bone className="size-8 rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <Bone className="h-4 w-40" />
                  <Bone className="bone-shimmer-soft h-3 w-32" />
                </div>
              </div>
              <Bone className="h-4 w-16" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BrandDealsSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton titleClass="h-10 w-[min(100%,12rem)]" />
      <div className="flex flex-col gap-6">
        <div className="flex items-end justify-between gap-4">
          <Bone className="bone-shimmer-tint h-[13px] w-28 rounded-full" />
          <Bone className="h-4 w-28" />
        </div>
        <div className="flex flex-col gap-8">
          {['a', 'b'].map((group) => (
            <section key={group} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-4">
                <Bone className="h-4 w-40" />
                <Bone className="h-3 w-6" />
              </div>
              <ul className="divide-y divide-border">
                {['x', 'y'].map((row) => (
                  <li
                    key={row}
                    className="flex items-center justify-between gap-4 px-2 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Bone className="size-6 rounded-full" />
                      <Bone className="h-4 w-28" />
                    </div>
                    <Bone className="h-4 w-16" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
