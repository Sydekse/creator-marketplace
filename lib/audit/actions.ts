/**
 * The vocabulary of the audit log (KAN-52, AC-031).
 *
 * `audit_log.action` and `audit_log.target_type` are `text` columns, so nothing
 * in the database stops a caller writing `verify_creator` where the last one
 * wrote `creator.verify`. That costs nothing until someone tries to satisfy the
 * ticket's last acceptance criterion — "filterable by action type" — and finds
 * the filter needs a list of every spelling anyone has ever used. A closed union
 * is what makes that filter answerable, so the vocabulary is declared here once
 * and every admin action names a member of it.
 *
 * Adding an action is a one-line change, and deliberately a visible one: a new
 * admin capability that nobody thought to log is exactly the gap FR-008 exists
 * to close.
 */

/**
 * Dotted `entity.verb`, matching the examples in the tech spec's `audit_log`
 * definition (§3.2).
 *
 * Approve and reject are separate actions rather than one `creator.decide` with
 * the outcome buried in `detail`. §4.6 exposes them as one endpoint taking a
 * `decision`, but "show me every rejection this month" is a question the log
 * should answer from an indexed column, not by opening every row's jsonb.
 */
export const AUDIT_ACTIONS = {
  CREATOR_VERIFY: 'creator.verify',
  CREATOR_REJECT: 'creator.reject',
  DEAL_RESOLVE_DISPUTE: 'deal.resolve_dispute',
  METRIC_EDIT: 'metric.edit',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Runtime list, for validating a filter query param against the union. */
export const AUDIT_ACTION_VALUES = Object.values(
  AUDIT_ACTIONS
) as readonly AuditAction[];

/** Table names, so a target is resolvable without a translation table. */
export const AUDIT_TARGET_TYPES = {
  CREATOR_PROFILE: 'creator_profile',
  DEAL: 'deal',
  VIDEO_METRIC: 'video_metric',
} as const;

export type AuditTargetType =
  (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES];

export const AUDIT_TARGET_TYPE_VALUES = Object.values(
  AUDIT_TARGET_TYPES
) as readonly AuditTargetType[];

/**
 * The one target type each action may name.
 *
 * Without this, `creator.verify` against a deal id is a well-typed call: both
 * fields are strings that pass their own union check independently. It would
 * also be undetectable afterwards — the row looks valid, and the id resolves to
 * a real row in the wrong table. Pairing them here turns that into a failure at
 * the call site instead of a quietly wrong audit trail.
 */
export const AUDIT_ACTION_TARGET: Record<AuditAction, AuditTargetType> = {
  [AUDIT_ACTIONS.CREATOR_VERIFY]: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
  [AUDIT_ACTIONS.CREATOR_REJECT]: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
  [AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE]: AUDIT_TARGET_TYPES.DEAL,
  [AUDIT_ACTIONS.METRIC_EDIT]: AUDIT_TARGET_TYPES.VIDEO_METRIC,
};

export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === 'string' &&
    (AUDIT_ACTION_VALUES as readonly string[]).includes(value)
  );
}

export function isAuditTargetType(value: unknown): value is AuditTargetType {
  return (
    typeof value === 'string' &&
    (AUDIT_TARGET_TYPE_VALUES as readonly string[]).includes(value)
  );
}
