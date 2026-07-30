import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { UserRole } from './schema';

/**
 * Better Auth's four tables, declared here so drizzle-kit owns the migrations
 * rather than Better Auth's own migrator (Tech Spec §3.2 defers the session /
 * account / verification shapes to the framework, but the repo still needs
 * versioned SQL for them).
 *
 * Two project invariants apply even though the library generated the starting
 * point for this file:
 *
 *   - PKs are `uuid` defaulting to `gen_random_uuid()`. Better Auth generates
 *     ids in application code, so `advanced.database.generateId: 'uuid'` in
 *     `lib/auth.ts` is what makes those columns receive UUIDs instead of its
 *     default random strings; the database default is the belt-and-braces case
 *     for any row inserted by something other than Better Auth (a seed script,
 *     a migration backfill).
 *   - Every timestamp is `timestamptz`. A bare `timestamp` column round-trips
 *     through the driver as local time, which would make `session.expiresAt`
 *     comparisons wrong by the server's UTC offset.
 *
 * Both invariants are hand-applied, so this file is hand-maintained from here
 * on. `better-auth generate` would overwrite it with text ids and timezone-less
 * timestamps; the CLI is deliberately not a dependency. Adding a Better Auth
 * plugin means adding its columns here by hand and running `npm run db:generate`.
 *
 * The type-only import of `UserRole` above is erased at compile time, so this
 * does not create a runtime cycle with `db/schema.ts`.
 */

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  // The column every server-side RBAC gate reads (FR-001, NFR-005).
  role: text('role').$type<UserRole>().default('creator').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)]
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    // Hashed by Better Auth (scrypt) — never a plaintext secret (Tech Spec §6.2).
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)]
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
