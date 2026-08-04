import { z } from 'zod';
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

export const verifyCreatorSchema = z.object({
  decision: z.enum(['verified', 'rejected'], {
    message: 'Decision must be "verified" or "rejected".',
  }),
  note: z.string().optional(),
});

export const resolveDisputeSchema = z.object({
  resolution: z.enum(['release', 'refund', 'revision'], {
    message: 'Resolution must be "release", "refund", or "revision".',
  }),
  note: z.string().min(1, { message: 'A resolution note is required.' }),
});
