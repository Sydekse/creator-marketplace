import { cn } from '@/lib/utils';

function Bone({ className }: { className?: string }) {
  return <div className={cn('bone-shimmer rounded-md', className)} />;
}

function PageHeaderSkeleton({ titleClass }: { titleClass?: string }) {
  return (
    <header className="flex flex-col gap-3">
      <Bone className="bone-shimmer-tint h-3 w-28 rounded-full" />
      <Bone className={cn('h-10 w-[min(100%,18rem)] rounded-lg', titleClass)} />
      <Bone className="bone-shimmer-soft h-4 w-[min(100%,28rem)]" />
      <div className="mt-1 border-b border-neutral-200" aria-hidden />
    </header>
  );
}

function InboxRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-4">
          <Bone className="size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className="h-3.5 w-40 max-w-full" />
            <Bone className="bone-shimmer-soft h-3 w-24" />
          </div>
          <Bone className="h-3.5 w-16" />
        </li>
      ))}
    </ul>
  );
}

/** Generic fallback under a ready nav island. */
export function WorkspacePageSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton />
      <InboxRows />
    </div>
  );
}

export function DiscoverSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton titleClass="w-[min(100%,14rem)]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Bone className="h-11 rounded-lg" />
        <Bone className="h-11 rounded-lg" />
        <Bone className="h-11 rounded-lg" />
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {['a', 'b', 'c', 'd'].map((key) => (
          <li
            key={key}
            className="flex flex-col gap-5 rounded-xl border border-neutral-200 bg-neutral-50 p-5"
          >
            <div className="flex items-center gap-3">
              <Bone className="size-8 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Bone className="h-4 w-36 max-w-full" />
                <Bone className="bone-shimmer-soft h-3 w-20" />
              </div>
              <Bone className="bone-shimmer-tint h-3 w-12 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-3 border-y border-neutral-200 py-4">
              <Bone className="h-8" />
              <Bone className="h-8" />
              <Bone className="h-8" />
            </div>
            <Bone className="bone-shimmer-soft h-3 w-28" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CreatorDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Bone className="h-8 w-36 rounded-full" />
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-16">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <Bone className="size-16 shrink-0 rounded-full sm:size-20" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Bone className="bone-shimmer-tint h-3 w-20 rounded-full" />
              <Bone className="h-10 w-[min(100%,16rem)] rounded-lg" />
              <Bone className="bone-shimmer-soft h-4 w-40" />
            </div>
          </div>
          <div className="grid grid-cols-1 border-y border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-neutral-200">
            <Bone className="h-24 rounded-none" />
            <Bone className="h-24 rounded-none" />
            <Bone className="h-24 rounded-none" />
          </div>
        </div>
        <Bone className="bone-shimmer-ink hidden h-72 rounded-[24px] lg:block" />
      </div>
    </div>
  );
}

export function CampaignDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Bone className="h-8 w-44 rounded-full" />
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,0.9fr)]">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Bone className="bone-shimmer-tint h-3 w-24 rounded-full" />
            <Bone className="h-10 w-[min(100%,20rem)] rounded-lg" />
            <Bone className="bone-shimmer-soft h-4 w-48" />
            <div className="border-b border-neutral-200" aria-hidden />
          </div>
          <InboxRows count={3} />
        </div>
        <Bone className="bone-shimmer-ink hidden h-72 rounded-[24px] lg:block" />
      </div>
    </div>
  );
}

export function DealDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-4">
      <PageHeaderSkeleton titleClass="w-[min(100%,16rem)]" />
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Bone className="h-16" />
        <Bone className="h-16" />
        <Bone className="h-16" />
        <Bone className="h-16" />
      </div>
      <div className="flex flex-col gap-4">
        <Bone className="h-36 rounded-xl" />
        <Bone className="h-36 rounded-xl" />
      </div>
    </div>
  );
}

export function AdminTableSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeaderSkeleton titleClass="w-[min(100%,16rem)]" />
      <div className="flex items-center justify-between border-y border-neutral-200 bg-neutral-100/45 px-4 py-3">
        <Bone className="bone-shimmer-tint h-3 w-28 rounded-full" />
        <Bone className="h-3 w-20" />
      </div>
      <InboxRows count={6} />
    </div>
  );
}

export function AdminConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <PageHeaderSkeleton titleClass="w-[min(100%,14rem)]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <div
            key={key}
            className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-5"
          >
            <Bone className="size-8 rounded-lg" />
            <Bone className="h-4 w-32" />
            <Bone className="bone-shimmer-soft h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotificationsSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeaderSkeleton titleClass="w-[min(100%,14rem)]" />
      <InboxRows count={5} />
    </div>
  );
}

export function CampaignListSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <PageHeaderSkeleton titleClass="w-[min(100%,12rem)]" />
      <InboxRows count={5} />
    </div>
  );
}
