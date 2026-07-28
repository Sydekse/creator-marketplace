export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Creator Marketplace
        </h1>
        <p className="text-sm text-muted-foreground">Sign in to get started.</p>
        <a
          href="/sign-in"
          className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign In
        </a>
      </div>
    </div>
  );
}
