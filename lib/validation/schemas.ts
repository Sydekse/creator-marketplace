import { z } from 'zod';
// Both are leaf modules — importing the query module instead would close a
// cycle back through `lib/authz` into this file. See `lib/audit/limits.ts`.
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';
import { MAX_AUDIT_LIMIT } from '@/lib/audit/limits';
// Also a leaf module — it imports nothing at all, which is what makes it safe
// to reach into from here.
import { MAX_STRING_LENGTH } from '@/lib/audit/redact';
import {
  AGE_RANGES,
  AUDIENCE_MARKET_CODES,
  MAX_ENGAGEMENT_RATE,
  NICHES,
} from '@/lib/config/creator-profile';
import {
  isValidTiktokHandle,
  normalizeTiktokHandle,
} from '@/lib/creators/handle';

export const signUpSchema = z.object({
  name: z.string().min(1, { message: 'Name is required.' }),
  email: z.string().email({ message: 'Enter a valid email address.' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters.' }),
  role: z.enum(['brand', 'creator'], {
    message: 'Role must be "brand" or "creator".',
  }),
});

export const signInSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

/**
 * Creator onboarding payload — `POST /api/creators` (AC-001, AC-003).
 *
 * The handle field is the security-relevant one. `.transform()` runs before
 * `.refine()`, so parsing *is* normalisation: there is no way to hold a parsed
 * `createCreatorSchema` output whose handle has not been canonicalised, and
 * therefore no code path that can reach the unique index with a raw value.
 * That ordering is what makes AC-003 hold for `@BeautyByHana` vs `beautybyhana`
 * — see `lib/creators/handle.ts` for why that matters.
 */
export const createCreatorSchema = z.object({
  tiktokHandle: z
    .string({ message: 'TikTok handle is required.' })
    .transform(normalizeTiktokHandle)
    .refine(isValidTiktokHandle, {
      message:
        'Enter a valid TikTok handle — 2–24 letters, numbers, underscores or periods.',
    }),
  niche: z.enum(NICHES, { message: 'Choose a niche.' }),
  audience: z.object({
    topCountries: z
      .array(z.enum(AUDIENCE_MARKET_CODES))
      .min(1, { message: 'Choose at least one audience market.' }),
    ageRange: z.enum(AGE_RANGES, { message: 'Choose an audience age range.' }),
    interests: z.array(z.string().min(1)).optional(),
  }),
  // Optional at sign-up, per the ticket. Left empty means no tier is assigned
  // and the creator is not bookable (AC-006) — which is already true here,
  // because tier assignment is KAN-23 and every profile starts untiered.
  followerCount: z
    .number()
    .int({ message: 'Follower count must be a whole number.' })
    .min(0, { message: 'Follower count cannot be negative.' })
    .optional(),
  engagementRate: z
    .number()
    .min(0, { message: 'Engagement rate cannot be negative.' })
    .max(MAX_ENGAGEMENT_RATE, {
      message: `Engagement rate cannot exceed ${MAX_ENGAGEMENT_RATE}%.`,
    })
    .optional(),
});

export type CreateCreatorInput = z.infer<typeof createCreatorSchema>;

/**
 * Longest company name accepted. `company_name` is an unbounded `text` column,
 * so this is the only limit there is — without it a brand could store a
 * megabyte of prose that every creator then has to read on every offer.
 * Exported so the input's `maxLength` and the server bound are one number.
 */
export const MAX_COMPANY_NAME_LENGTH = 120;

/**
 * The company name, shared by create and update.
 *
 * `.trim()` runs before the length checks, so `'   '` is rejected as empty
 * rather than stored as three spaces — a name that renders as nothing on a deal
 * offer would satisfy `not null` while defeating the point of the column. The
 * trimmed value is what parsing yields, so the row can never hold the padded
 * form either.
 *
 * That is the whole of the normalisation here. Unlike a TikTok handle, a company
 * name is not a key — two brands may legitimately share one, and case is the
 * brand's to choose — so there is nothing else to canonicalise.
 */
const companyName = z
  .string({ message: 'Company name is required.' })
  .trim()
  .min(1, { message: 'Company name is required.' })
  .max(MAX_COMPANY_NAME_LENGTH, {
    message: `Company name cannot exceed ${MAX_COMPANY_NAME_LENGTH} characters.`,
  });

/** Brand onboarding payload — `POST /api/brands` (KAN-27, FR-001). */
export const createBrandSchema = z.object({ companyName });

/**
 * Brand profile edit — `PATCH /api/brands/{id}`.
 *
 * Identical to `createBrandSchema` today because `company_name` is the only
 * column a brand owns. Kept as a separate schema rather than an alias so that a
 * create-only field added later (say, a signup source) does not silently become
 * editable by inheriting this route's parser.
 */
export const updateBrandSchema = z.object({ companyName });

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

export const discoverCreatorsSchema = z.object({
  niche: z.string().optional(),
  minEngagement: z.number().min(0).optional(),
  priceMin: z.number().int().min(0).optional(),
  priceMax: z.number().int().min(0).optional(),
  audience: z.record(z.string(), z.unknown()).optional(),
});

const tiktokUrlPattern =
  /^(https?:\/\/)?(www\.)?(tiktok\.com\/@[\w.-]+\/video\/\d+|vm\.tiktok\.com\/[\w-]+)/;

export const createCampaignSchema = z.object({
  name: z.string().min(1, { message: 'Campaign name is required.' }),
  goal: z.string().optional(),
  targetAudience: z.record(z.string(), z.unknown()).optional(),
  budget: z
    .number()
    .int()
    .positive({ message: 'Budget must be greater than zero.' }),
  desiredVideos: z
    .number()
    .int()
    .positive({ message: 'Desired videos must be greater than zero.' }),
});

export const addCampaignItemSchema = z.object({
  creatorId: z.string().uuid({ message: 'Valid creator ID is required.' }),
  videoCount: z
    .number()
    .int()
    .positive({ message: 'Video count must be greater than zero.' }),
});

export const acceptDealSchema = z.object({
  rightsTermsId: z
    .string()
    .uuid({ message: 'Valid rights terms ID is required.' }),
});

export const submitDeliverableSchema = z.object({
  tiktokUrl: z.string().min(1).regex(tiktokUrlPattern, {
    message: 'Enter a valid public TikTok video link.',
  }),
});

export const rejectDeliverableSchema = z.object({
  reason: z.string().min(1, { message: 'A rejection reason is required.' }),
});

export const updateMetricsSchema = z.object({
  views: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
});

/**
 * Longest rejection note accepted, deliberately the same bound `audit_log`
 * truncates at.
 *
 * The note fans out to three places from one field: the audit row, the
 * `notification.payload` jsonb, and the body of the creator's email. Only the
 * first of those is bounded downstream — `redactDetail` caps it — so without a
 * limit here the other two are unbounded, and an admin's note is the one piece
 * of free text on this endpoint that reaches an outbound email. Matching
 * `MAX_STRING_LENGTH` rather than picking a larger round number means the log
 * records the note in full, so what the creator read and what the audit trail
 * shows can never be two different strings (AC-031, NFR-010).
 */
export const MAX_VERIFICATION_NOTE_LENGTH = MAX_STRING_LENGTH;

export const verifyCreatorSchema = z
  .object({
    decision: z.enum(['verified', 'rejected'], {
      message: 'Decision must be "verified" or "rejected".',
    }),
    note: z
      .string()
      .trim()
      .max(MAX_VERIFICATION_NOTE_LENGTH, {
        message: `Note cannot exceed ${MAX_VERIFICATION_NOTE_LENGTH} characters.`,
      })
      // A note of spaces is not a note. Collapsed to `undefined` here rather
      // than rejected, because the field is optional and "I typed nothing" is
      // the same intent as "I left it blank" — but left as `''` it would reach
      // the template's `payload.reason ?` truthiness check as a real value and
      // render an empty paragraph in the rejection email.
      .transform((value) => value || undefined)
      .optional(),
  })
  // Unknown keys are rejected rather than stripped, the same call
  // `auditLogQuerySchema` makes below and for the same reason. Stripping is the
  // default, and it means a caller who sends `notes` gets a 200, a creator
  // rejected with no explanation, and an audit row recording no note — three
  // wrong outcomes and no error anywhere.
  .strict();

export const resolveDisputeSchema = z.object({
  resolution: z.enum(['release', 'refund', 'revision'], {
    message: 'Resolution must be "release", "refund", or "revision".',
  }),
  note: z.string().min(1, { message: 'A resolution note is required.' }),
});

/**
 * Audit log filters — `GET /api/admin/audit-log` (KAN-52, AC-031).
 *
 * Every value arrives as a string from the query string, so the numeric and
 * date fields coerce. `action` and `target_type` are parsed against the closed
 * vocabulary rather than as free text: an unknown action can only be a typo or
 * a probe, and returning "no rows" for it would read as "this never happened"
 * rather than "you asked for something that does not exist".
 */
export const auditLogQuerySchema = z
  .object({
    actorId: z
      .string()
      .uuid({ message: 'Actor must be a valid ID.' })
      .optional(),
    action: z
      .enum(AUDIT_ACTIONS, { message: 'Unknown audit action.' })
      .optional(),
    targetType: z
      .enum(AUDIT_TARGET_TYPES, { message: 'Unknown audit target type.' })
      .optional(),
    targetId: z
      .string()
      .uuid({ message: 'Target must be a valid ID.' })
      .optional(),
    from: z.coerce.date({ message: 'From must be a valid date.' }).optional(),
    to: z.coerce.date({ message: 'To must be a valid date.' }).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, { message: 'Limit must be at least 1.' })
      .max(MAX_AUDIT_LIMIT, {
        message: `Limit cannot exceed ${MAX_AUDIT_LIMIT}.`,
      })
      .optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0, { message: 'Offset cannot be negative.' })
      .optional(),
  })
  // Unknown keys are rejected, not stripped — flagged in the KAN-52 review.
  //
  // Zod's default is to drop what it does not recognise, which on a *filter*
  // schema is the dangerous direction: a misspelled filter contributes no
  // condition, so the request succeeds with no WHERE clause and returns the
  // whole table. An admin asking "what did actor X do" would get every row back
  // with nothing to indicate their filter was ignored, and on this table of all
  // tables that answer reads as authoritative.
  //
  // `.strict()` turns that into a 422 naming the key. It has to come before
  // `.refine()`, which returns a schema that no longer has the method.
  .strict()
  // An inverted range is almost always a swapped pair of inputs rather than a
  // deliberate request for nothing. Saying so beats returning an empty list
  // that looks like a clean bill of health.
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'From must be on or before to.',
    path: ['from'],
  });

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
