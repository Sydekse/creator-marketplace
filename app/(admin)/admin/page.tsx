import { requireRole } from '@/lib/auth';

export default async function AdminConsolePage() {
  const user = await requireRole('admin');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin console</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name ?? user.email}.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <a
          href="/admin/verification"
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
        >
          <h2 className="font-semibold">Verification queue</h2>
          <p className="text-sm text-muted-foreground">
            Review pending creator profiles
          </p>
        </a>
      </div>
    </div>
  );
}
