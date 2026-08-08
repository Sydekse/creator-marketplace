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
  MAX_COMPANY_NAME_LENGTH,
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_CAMPAIGN_GOAL_LENGTH,
  MAX_CAMPAIGN_TARGET_AUDIENCE_LENGTH,
  MAX_VERIFICATION_NOTE_LENGTH,
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
