import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ErrorCode,
  ErrorMessage,
  ErrorHttpStatus,
  errorResponse,
  validationError,
  fromZodError,
  createCreatorSchema,
  discoverCreatorsSchema,
  createCampaignSchema,
  addCampaignItemSchema,
  acceptDealSchema,
  submitDeliverableSchema,
  rejectDeliverableSchema,
  MAX_REJECTION_REASON_LENGTH,
  updateMetricsSchema,
  verifyCreatorSchema,
  resolveDisputeSchema,
} from '../lib/validation';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

describe('ErrorCode enum', () => {
  it('has no duplicate values, so every response code is unambiguous', () => {
    const codes = Object.values(ErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('defines the 12 spec codes plus the thirteen of our own', () => {
    const codes = Object.values(ErrorCode);
    // 12 from the PRD table, plus PROFILE_EXISTS (KAN-21), NOT_FOUND (KAN-52
    // audit read path), CREATOR_NOT_PENDING (KAN-22), CREATOR_NOT_VERIFIED
    // (KAN-23), CREATOR_NOT_BOOKABLE (KAN-30), CREATOR_ALREADY_IN_CART (KAN-30),
    // CAMPAIGN_NOT_DRAFT (KAN-26, KAN-30), RIGHTS_TERMS_STALE (KAN-36) and
    // CAMPAIGN_NOT_FUNDABLE (KAN-43). None is an AC string:
    // PROFILE_EXISTS covers the *other* unique constraint on `creator_profile`
    // (`user_id`), which AC-003's message would describe wrongly; NOT_FOUND is
    // the envelope member admin endpoints return when the caller is entitled to
    // know a row is absent; CREATOR_NOT_PENDING guards the verification decision
    // against an already-reviewed creator (distinct from OFFER_NOT_PENDING);
    // CREATOR_NOT_VERIFIED guards tier assignment against a pending/rejected one;
    // CREATOR_NOT_BOOKABLE guards bookability;
    // CREATOR_ALREADY_IN_CART guards duplicate items; CAMPAIGN_NOT_DRAFT guards
    // edits against non-draft campaigns; RIGHTS_TERMS_STALE answers an accept
    // whose terms version was superseded, where OFFER_NOT_PENDING's sentence
    // would be false — the offer still is pending;
    // CAMPAIGN_NOT_FUNDABLE answers a fund on a campaign that is not
    // `confirmed` — either still `draft` or already `funded`. AC-019 gives
    // NO_ACCEPTED_DEALS for the empty-cart case only, and reusing it here would
    // tell a brand who just funded that nobody has accepted. See the comments on
    // the enum members.
    //
    // Plus the four cron-infrastructure codes (KAN-56): CRON_TIMEOUT,
    // CRON_PARTIAL_FAILURE, UNAUTHORIZED and INTERNAL_SERVER_ERROR. Not part of
    // the §4.7 table (the cron route is Vercel infrastructure, not the §4 REST
    // surface) but members of the enum so the route's responses carry the same
    // `ErrorEnvelope` type instead of ad-hoc strings.
    //
    // Plus REASON_REQUIRED (KAN-47), which AC-024 and §4.4 name for a
    // rejection with no reason — see the enum member's comment for why it is
    // not a VALIDATION_ERROR.
    //
    // The count is the point of this test: it is what makes adding a code a
    // deliberate act rather than something that slips in.
    expect(codes).toHaveLength(26);
    expect(codes).toContain(ErrorCode.TIKTOK_HANDLE_TAKEN);
    expect(codes).toContain(ErrorCode.CAMPAIGN_NOT_FUNDABLE);
    expect(codes).toContain(ErrorCode.PROFILE_EXISTS);
    expect(codes).toContain(ErrorCode.CREATOR_NOT_PENDING);
    expect(codes).toContain(ErrorCode.CREATOR_NOT_VERIFIED);
    expect(codes).toContain(ErrorCode.CREATOR_NOT_BOOKABLE);
    expect(codes).toContain(ErrorCode.CREATOR_ALREADY_IN_CART);
    expect(codes).toContain(ErrorCode.CAMPAIGN_NOT_DRAFT);
    expect(codes).toContain(ErrorCode.BUDGET_NOT_POSITIVE);
    expect(codes).toContain(ErrorCode.BUDGET_EXCEEDED);
    expect(codes).toContain(ErrorCode.OFFER_NOT_PENDING);
    expect(codes).toContain(ErrorCode.OFFER_EXPIRED);
    expect(codes).toContain(ErrorCode.PAYMENT_FAILED);
    expect(codes).toContain(ErrorCode.NO_ACCEPTED_DEALS);
    expect(codes).toContain(ErrorCode.INVALID_TIKTOK_URL);
    expect(codes).toContain(ErrorCode.DEAL_NOT_FUNDED);
    expect(codes).toContain(ErrorCode.DEAL_NOT_DELIVERED);
    expect(codes).toContain(ErrorCode.REASON_REQUIRED);
    expect(codes).toContain(ErrorCode.FORBIDDEN);
    expect(codes).toContain(ErrorCode.VALIDATION_ERROR);
    expect(codes).toContain(ErrorCode.NOT_FOUND);
    expect(codes).toContain(ErrorCode.CRON_TIMEOUT);
    expect(codes).toContain(ErrorCode.CRON_PARTIAL_FAILURE);
    expect(codes).toContain(ErrorCode.UNAUTHORIZED);
    expect(codes).toContain(ErrorCode.INTERNAL_SERVER_ERROR);
  });
});

describe('ErrorMessage', () => {
  it('maps each code to the exact PRD-required message', () => {
    expect(ErrorMessage[ErrorCode.TIKTOK_HANDLE_TAKEN]).toBe(
      'This TikTok account is already registered.'
    );
    expect(ErrorMessage[ErrorCode.BUDGET_NOT_POSITIVE]).toBe(
      'Budget must be greater than zero.'
    );
    expect(ErrorMessage[ErrorCode.BUDGET_EXCEEDED]).toBe(
      'This exceeds your remaining budget.'
    );
    expect(ErrorMessage[ErrorCode.PAYMENT_FAILED]).toBe(
      'Payment failed — please try again.'
    );
    expect(ErrorMessage[ErrorCode.INVALID_TIKTOK_URL]).toBe(
      'Enter a valid public TikTok video link.'
    );
    expect(ErrorMessage[ErrorCode.REASON_REQUIRED]).toBe(
      'A rejection reason is required.'
    );
  });

  it('has a message for every code', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof ErrorMessage[code]).toBe('string');
      expect(ErrorMessage[code].length).toBeGreaterThan(0);
    }
  });
});

describe('ErrorHttpStatus', () => {
  it('maps each code to the correct HTTP status', () => {
    expect(ErrorHttpStatus[ErrorCode.TIKTOK_HANDLE_TAKEN]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.BUDGET_NOT_POSITIVE]).toBe(422);
    expect(ErrorHttpStatus[ErrorCode.BUDGET_EXCEEDED]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.OFFER_NOT_PENDING]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.OFFER_EXPIRED]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.PAYMENT_FAILED]).toBe(402);
    expect(ErrorHttpStatus[ErrorCode.NO_ACCEPTED_DEALS]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.INVALID_TIKTOK_URL]).toBe(422);
    expect(ErrorHttpStatus[ErrorCode.DEAL_NOT_FUNDED]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.DEAL_NOT_DELIVERED]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.REASON_REQUIRED]).toBe(422);
    expect(ErrorHttpStatus[ErrorCode.FORBIDDEN]).toBe(403);
    expect(ErrorHttpStatus[ErrorCode.VALIDATION_ERROR]).toBe(422);
  });

  it('has a status for every code', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof ErrorHttpStatus[code]).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// Error envelope helpers
// ---------------------------------------------------------------------------

describe('errorResponse', () => {
  it('returns the correct envelope shape', () => {
    const result = errorResponse(ErrorCode.BUDGET_NOT_POSITIVE);
    expect(result).toEqual({
      error: {
        code: ErrorCode.BUDGET_NOT_POSITIVE,
        message: 'Budget must be greater than zero.',
      },
    });
  });

  it('includes details when provided', () => {
    const result = errorResponse(ErrorCode.BUDGET_NOT_POSITIVE, {
      budget: ['Must be greater than zero.'],
    });
    expect(result.error.details).toEqual({
      budget: ['Must be greater than zero.'],
    });
  });
});

describe('validationError', () => {
  it('returns VALIDATION_ERROR with details', () => {
    const result = validationError({ name: ['Required.'] });
    expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(result.error.message).toBe('Validation failed.');
    expect(result.error.details).toEqual({ name: ['Required.'] });
  });
});

describe('fromZodError', () => {
  it('converts a ZodError into the error envelope', () => {
    const schema = z.object({ name: z.string().min(1) });
    try {
      schema.parse({ name: '' });
    } catch (e) {
      if (e instanceof z.ZodError) {
        const result = fromZodError(e);
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.error.details).toBeDefined();
        expect(result.error.details!['name']).toBeDefined();
        expect(result.error.details!['name'].length).toBeGreaterThan(0);
      }
    }
  });

  it('handles multiple field errors', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
    });
    try {
      schema.parse({ name: '', age: -1 });
    } catch (e) {
      if (e instanceof z.ZodError) {
        const result = fromZodError(e);
        expect(result.error.details!['name']).toBeDefined();
        expect(result.error.details!['age']).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Schemas — Creators
// ---------------------------------------------------------------------------

/**
 * Smoke-level only. `audience` became a structured object in KAN-21 (closed
 * niche/market/age lists, so AC-010's discovery filters can match on equality),
 * and the handle field now normalises on parse. The exhaustive cases for all of
 * that — normalisation, field paths, bounds — live in
 * `__tests__/creator-onboarding.test.ts`, next to the code they constrain.
 */
describe('createCreatorSchema', () => {
  it('accepts valid creator data', () => {
    const result = createCreatorSchema.parse({
      tiktokHandle: '@beautybyhana',
      niche: 'beauty',
      audience: { topCountries: ['ET'], ageRange: '18-24' },
    });
    expect(result.tiktokHandle).toBe('@beautybyhana');
    expect(result.niche).toBe('beauty');
  });

  it('rejects missing tiktokHandle', () => {
    expect(() =>
      createCreatorSchema.parse({
        niche: 'beauty',
        audience: { topCountries: ['ET'], ageRange: '18-24' },
      })
    ).toThrow();
  });

  it('rejects empty niche', () => {
    expect(() =>
      createCreatorSchema.parse({
        tiktokHandle: '@test',
        niche: '',
        audience: { topCountries: ['ET'], ageRange: '18-24' },
      })
    ).toThrow();
  });

  it('rejects empty audience', () => {
    expect(() =>
      createCreatorSchema.parse({
        tiktokHandle: '@test',
        niche: 'beauty',
        audience: {},
      })
    ).toThrow();
  });
});

describe('discoverCreatorsSchema', () => {
  it('accepts no filters (all optional)', () => {
    const result = discoverCreatorsSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts all filters, coercing the numbers out of query strings', () => {
    // Every value arrives as a string from a query string — the coercion is what
    // lets the same schema serve the URL and a typed caller.
    const result = discoverCreatorsSchema.parse({
      niche: 'beauty',
      audience: 'ET',
      minEngagement: '2.5',
      priceMin: '50000',
      priceMax: '200000',
    });
    expect(result.niche).toBe('beauty');
    expect(result.audience).toBe('ET');
    expect(result.minEngagement).toBe(2.5);
    expect(result.priceMin).toBe(50_000);
    expect(result.priceMax).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// Schemas — Campaigns
// ---------------------------------------------------------------------------

describe('createCampaignSchema', () => {
  it('accepts valid campaign data', () => {
    const result = createCampaignSchema.parse({
      name: 'Summer Launch',
      goal: 'Increase brand awareness',
      budget: 500000,
      desiredVideos: 10,
    });
    expect(result.name).toBe('Summer Launch');
    expect(result.budget).toBe(500000);
    expect(result.desiredVideos).toBe(10);
  });

  it('rejects zero budget (AC-008)', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 0,
        desiredVideos: 5,
      })
    ).toThrow('Budget must be greater than zero.');
  });

  it('rejects negative budget', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: -100,
        desiredVideos: 5,
      })
    ).toThrow();
  });

  it('rejects non-integer budget', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 100.5,
        desiredVideos: 5,
      })
    ).toThrow();
  });

  it('rejects zero desiredVideos', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 1000,
        desiredVideos: 0,
      })
    ).toThrow();
  });

  it('accepts optional fields', () => {
    const result = createCampaignSchema.parse({
      name: 'Test',
      budget: 1000,
      desiredVideos: 5,
    });
    expect(result.goal).toBeUndefined();
    expect(result.targetAudience).toBeUndefined();
  });
});

describe('addCampaignItemSchema', () => {
  it('accepts valid item data', () => {
    const result = addCampaignItemSchema.parse({
      creatorId: '550e8400-e29b-41d4-a716-446655440000',
      videoCount: 3,
    });
    expect(result.creatorId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.videoCount).toBe(3);
  });

  it('rejects invalid creatorId', () => {
    expect(() =>
      addCampaignItemSchema.parse({
        creatorId: 'not-a-uuid',
        videoCount: 1,
      })
    ).toThrow();
  });

  it('rejects zero videoCount', () => {
    expect(() =>
      addCampaignItemSchema.parse({
        creatorId: '550e8400-e29b-41d4-a716-446655440000',
        videoCount: 0,
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schemas — Deals
// ---------------------------------------------------------------------------

describe('acceptDealSchema', () => {
  it('accepts valid rightsTermsId', () => {
    const result = acceptDealSchema.parse({
      rightsTermsId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.rightsTermsId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects invalid rightsTermsId', () => {
    expect(() => acceptDealSchema.parse({ rightsTermsId: 'bad' })).toThrow();
  });
});

describe('submitDeliverableSchema', () => {
  it('accepts a valid TikTok video URL', () => {
    const result = submitDeliverableSchema.parse({
      tiktokUrl: 'https://www.tiktok.com/@user/video/1234567890123456789',
    });
    expect(result.tiktokUrl).toContain('tiktok.com');
  });

  it('accepts the mobile host, which the TikTok app hands out (m.tiktok.com)', () => {
    // The mobile app's share sheet produces `m.tiktok.com/@user/video/<id>`;
    // a valid public video link on the `m.` host is still a valid public
    // video link.
    const result = submitDeliverableSchema.parse({
      tiktokUrl: 'https://m.tiktok.com/@user/video/1234567890123456789',
    });
    expect(result.tiktokUrl).toContain('m.tiktok.com');
  });

  it('rejects a host that stacks the mobile prefix onto the shortener', () => {
    // The `m.`/`www.` prefix is only legal in front of `tiktok.com` — a host
    // like `m.vm.tiktok.com` does not exist and must not be admitted by
    // accident of the alternation.
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://m.vm.tiktok.com/abc123',
      })
    ).toThrow('Enter a valid public TikTok video link.');
  });

  it('rejects a URL longer than the storage bound', () => {
    const long = `https://www.tiktok.com/@${'a'.repeat(3000)}/video/123`;
    expect(() => submitDeliverableSchema.parse({ tiktokUrl: long })).toThrow(
      'Enter a valid public TikTok video link.'
    );
  });

  it('accepts a vm.tiktok.com short URL with or without a trailing slash', () => {
    expect(
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://vm.tiktok.com/abc123/',
      }).tiktokUrl
    ).toBe('https://vm.tiktok.com/abc123/');
    expect(
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://vm.tiktok.com/abc123',
      }).tiktokUrl
    ).toBe('https://vm.tiktok.com/abc123');
  });

  it('accepts a share URL carrying its query string', () => {
    // TikTok share links arrive with `?is_from_webapp=1&…`; bouncing them
    // would reject the exact strings a creator copies out of the app.
    const result = submitDeliverableSchema.parse({
      tiktokUrl:
        'https://www.tiktok.com/@user/video/1234567890123456789?is_from_webapp=1&sender_device=pc',
    });
    expect(result.tiktokUrl).toContain('is_from_webapp=1');
  });

  it('accepts a protocol-less link and trims paste whitespace', () => {
    expect(
      submitDeliverableSchema.parse({
        tiktokUrl: '  www.tiktok.com/@user/video/123  ',
      }).tiktokUrl
    ).toBe('www.tiktok.com/@user/video/123');
  });

  it('rejects a non-TikTok URL (AC-025)', () => {
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://youtube.com/watch?v=123',
      })
    ).toThrow('Enter a valid public TikTok video link.');
  });

  it('rejects an arbitrary host that contains tiktok.com (AC-025)', () => {
    // An unanchored pattern would match `tiktok.com` inside this. The allowlist
    // is the authority, not a substring search.
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://tiktok.com.example.net/@user/video/123',
      })
    ).toThrow('Enter a valid public TikTok video link.');
  });

  it('rejects a non-video TikTok page (AC-025)', () => {
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://www.tiktok.com/@user',
      })
    ).toThrow('Enter a valid public TikTok video link.');
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://www.tiktok.com/@user/photo/123',
      })
    ).toThrow('Enter a valid public TikTok video link.');
  });

  it('rejects trailing garbage after a valid video id', () => {
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'https://www.tiktok.com/@user/video/123/evil',
      })
    ).toThrow('Enter a valid public TikTok video link.');
  });

  it('rejects javascript: and other non-http schemes', () => {
    expect(() =>
      submitDeliverableSchema.parse({ tiktokUrl: 'javascript:alert(1)' })
    ).toThrow();
    expect(() =>
      submitDeliverableSchema.parse({
        tiktokUrl: 'ftp://tiktok.com/@user/video/123',
      })
    ).toThrow();
  });

  it('rejects an empty or blank URL', () => {
    expect(() => submitDeliverableSchema.parse({ tiktokUrl: '' })).toThrow();
    expect(() => submitDeliverableSchema.parse({ tiktokUrl: '   ' })).toThrow();
  });
});

describe('rejectDeliverableSchema', () => {
  it('accepts a rejection with reason', () => {
    const result = rejectDeliverableSchema.parse({
      reason: 'Does not match the brief.',
    });
    expect(result.reason).toBe('Does not match the brief.');
  });

  it('trims the stored reason, so padding never reaches the email', () => {
    // The reason fans out to the deliverable row and the creator's email;
    // leading/trailing whitespace would be stored and quoted verbatim.
    const result = rejectDeliverableSchema.parse({
      reason: '  Does not match the brief.  ',
    });
    expect(result.reason).toBe('Does not match the brief.');
  });

  it('rejects an empty reason', () => {
    expect(() => rejectDeliverableSchema.parse({ reason: '' })).toThrow();
  });

  it('rejects a reason of only spaces', () => {
    // Trimmed, a spaces-only note is an empty note — AC-2's "empty reason".
    expect(() => rejectDeliverableSchema.parse({ reason: '   ' })).toThrow(
      'A rejection reason is required.'
    );
  });

  it('rejects a reason over the stored length bound', () => {
    const long = 'x'.repeat(MAX_REJECTION_REASON_LENGTH + 1);
    expect(() => rejectDeliverableSchema.parse({ reason: long })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schemas — Metrics
// ---------------------------------------------------------------------------

describe('updateMetricsSchema', () => {
  it('accepts all metrics as optional', () => {
    const result = updateMetricsSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts partial metrics', () => {
    const result = updateMetricsSchema.parse({ views: 1000, likes: 500 });
    expect(result.views).toBe(1000);
    expect(result.likes).toBe(500);
  });

  it('rejects negative values', () => {
    expect(() => updateMetricsSchema.parse({ views: -1 })).toThrow();
  });

  it('rejects non-integer values', () => {
    expect(() => updateMetricsSchema.parse({ views: 100.5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schemas — Admin
// ---------------------------------------------------------------------------

describe('verifyCreatorSchema', () => {
  it('accepts verified decision', () => {
    const result = verifyCreatorSchema.parse({ decision: 'verified' });
    expect(result.decision).toBe('verified');
  });

  it('accepts rejected decision', () => {
    const result = verifyCreatorSchema.parse({ decision: 'rejected' });
    expect(result.decision).toBe('rejected');
  });

  it('rejects invalid decision', () => {
    expect(() => verifyCreatorSchema.parse({ decision: 'maybe' })).toThrow();
  });

  it('accepts optional note', () => {
    const result = verifyCreatorSchema.parse({
      decision: 'verified',
      note: 'Handle confirmed.',
    });
    expect(result.note).toBe('Handle confirmed.');
  });
});

describe('resolveDisputeSchema', () => {
  it('accepts release resolution', () => {
    const result = resolveDisputeSchema.parse({
      resolution: 'release',
      note: 'Approved after review.',
    });
    expect(result.resolution).toBe('release');
  });

  it('accepts refund resolution', () => {
    const result = resolveDisputeSchema.parse({
      resolution: 'refund',
      note: 'Refunding due to non-delivery.',
    });
    expect(result.resolution).toBe('refund');
  });

  it('accepts revision resolution', () => {
    const result = resolveDisputeSchema.parse({
      resolution: 'revision',
      note: 'Requesting re-edit.',
    });
    expect(result.resolution).toBe('revision');
  });

  it('rejects invalid resolution', () => {
    expect(() =>
      resolveDisputeSchema.parse({
        resolution: 'invalid',
        note: 'Reason.',
      })
    ).toThrow();
  });

  it('rejects empty note', () => {
    expect(() =>
      resolveDisputeSchema.parse({
        resolution: 'release',
        note: '',
      })
    ).toThrow();
  });
});
