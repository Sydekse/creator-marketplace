import { deal } from '@/db/schema';

export const deadlineColumns = {
  deliveryWindowDays: deal.deliveryWindowDays,
  originalDeliveryDueAt: deal.originalDeliveryDueAt,
  currentDeliveryDueAt: deal.currentDeliveryDueAt,
  firstDeliveredAt: deal.firstDeliveredAt,
  dueAtFirstDelivery: deal.dueAtFirstDelivery,
  missedDeliveryCommitment: deal.missedDeliveryCommitment,
};
