import { z } from 'zod';

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

export const createCreatorSchema = z.object({
  tiktokHandle: z.string().min(1, { message: 'TikTok handle is required.' }),
  niche: z.string().min(1, { message: 'Niche is required.' }),
  audience: z
    .record(z.string(), z.unknown())
    .refine((val) => Object.keys(val).length > 0, {
      message: 'Audience details are required.',
    }),
});

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
