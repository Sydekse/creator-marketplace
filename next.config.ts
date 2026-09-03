import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // This worktree sits under a parent that also has a lockfile. Pin the
  // Turbopack root here so Next does not treat ~/package-lock.json as the app.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
