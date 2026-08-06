/**
 * Page bounds for the audit log read path (KAN-52).
 *
 * These live in their own module, rather than beside the query that enforces
 * them, to keep an import cycle from forming. The request schema needs them at
 * module scope to build `z.max(...)`, and the chain from there is
 * `lib/validation/schemas` -> `lib/audit/queries` -> `lib/authz` ->
 * `lib/validation` -> `lib/validation/schemas`. A cycle evaluated during module
 * initialisation is the kind that yields `undefined` rather than an error, so
 * the bound would silently vanish. This file imports nothing, which is the
 * property that matters about it.
 */

export const DEFAULT_AUDIT_LIMIT = 50;

/**
 * Hard ceiling on one page. The table only ever grows, so an unbounded `limit`
 * is a way to ask the database for the whole audit history in one query.
 */
export const MAX_AUDIT_LIMIT = 200;
