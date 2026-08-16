export {
  transitionDeal,
  TransitionError,
  LEGAL_TRANSITIONS,
  getErrorCodeForInvalidTransition,
  canAct,
  canDeliver,
  canReview,
  canReportMetrics,
} from './state-machine';

export { getDealHistory } from './queries';
export type { DealHistoryRow } from './queries';

export {
  DEAL_GROUPS,
  GROUP_LABELS,
  groupForStatus,
  groupDeals,
  labelForStatus,
} from './groups';
export type { DealGroup } from './groups';
