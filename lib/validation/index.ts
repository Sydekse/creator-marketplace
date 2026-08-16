export {
  ErrorCode,
  ErrorMessage,
  ErrorHttpStatus,
  errorResponse,
  validationError,
  fromZodError,
  zodIssuesToDetails,
} from './errors';
export type { ErrorEnvelope } from './errors';

export { fieldErrorsAt } from './field-errors';
export type { FieldErrorMap } from './field-errors';

export type {
  CreateCreatorInput,
  CreateBrandInput,
  UpdateBrandInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  DiscoverCreatorsInput,
  AuditLogQueryInput,
  AddCampaignItemInput,
} from './schemas';

export {
  UUID_REGEX,
  TIKTOK_VIDEO_URL_PATTERN,
  MAX_TIKTOK_URL_LENGTH,
  MAX_COMPANY_NAME_LENGTH,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_GOAL_LENGTH,
  MAX_CAMPAIGN_TARGET_AUDIENCE_LENGTH,
  MAX_VERIFICATION_NOTE_LENGTH,
  MAX_REJECTION_REASON_LENGTH,
  MAX_METRIC_COUNT,
  signUpSchema,
  signInSchema,
  createCreatorSchema,
  createBrandSchema,
  updateBrandSchema,
  discoverCreatorsSchema,
  createCampaignSchema,
  updateCampaignSchema,
  addCampaignItemSchema,
  acceptDealSchema,
  submitDeliverableSchema,
  rejectDeliverableSchema,
  updateMetricsSchema,
  verifyCreatorSchema,
  resolveDisputeSchema,
  auditLogQuerySchema,
} from './schemas';
