// Drizzle schema. Tables land here in KAN-14 (Tech Spec §3.2).
//
// This file exists so the migration plumbing wired up in KAN-15 has a target:
// `drizzle.config.ts` points at it, and `npm run db:generate` diffs it against
// the recorded migrations. It is intentionally empty until KAN-14.

export {};
