export const REVISION_CATEGORIES = [
  'brief_requirement',
  'message_accuracy',
  'audio_visual_quality',
  'disclosure_compliance',
  'brand_requested_change',
  'other',
] as const;

export type RevisionCategory = (typeof REVISION_CATEGORIES)[number];
export const REVISION_CATEGORY_LABELS: Record<RevisionCategory, string> = {
  brief_requirement: 'Brief requirement',
  message_accuracy: 'Message accuracy',
  audio_visual_quality: 'Audio / visual quality',
  disclosure_compliance: 'Disclosure / compliance',
  brand_requested_change: 'Brand-requested change',
  other: 'Other',
};

export type DeliverableEventKind =
  | 'legacy_baseline'
  | 'submitted'
  | 'superseded'
  | 'review_ready'
  | 'review_interrupted'
  | 'revision_requested'
  | 'batch_approved'
  | 'admin_release'
  | 'refunded';

export const EVENT_LABELS: Record<DeliverableEventKind, string> = {
  legacy_baseline: 'Legacy record adopted — earlier history unavailable',
  submitted: 'Submitted',
  superseded: 'Replaced',
  review_ready: 'Ready for deal review',
  review_interrupted: 'Deal review interrupted',
  revision_requested: 'Revision requested',
  batch_approved: 'Approved with the deal',
  admin_release: 'Admin released payment',
  refunded: 'Deal refunded',
};

export type ExpectedVersion = { id: string; submissionVersion: number };
export type EvidenceMetadata = {
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string | null;
  recordedSubmittedAt?: string;
  requestExpectedVersion?: number;
  requestExpectedSubmitted?: number;
  videoOrdinal?: number;
  requestTargetId?: string | null;
  submitted?: number;
  status?: 'funded' | 'revision_requested' | 'delivered';
  metrics?: {
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
    source: 'creator' | 'admin';
    lastUpdatedAt: string | null;
    stale: boolean;
  } | null;
};
