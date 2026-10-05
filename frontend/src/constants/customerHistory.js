import { getServiceTagShortLabel } from './serviceTags';

export const CUSTOMER_HISTORY_ACTIVITY_FILTERS = [
  { value: 'all', label: 'All activities' },
  { value: 'new_account', label: 'New account' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'topup', label: 'Top-up' },
];

export function customerHistoryActivityLabel(activity) {
  switch (activity) {
    case 'customer_subscribe':
      return 'Subscribe';
    case 'customer_renew':
      return 'Renewal';
    case 'customer_upgrade':
      return 'Upgrade';
    case 'bulk_create':
      return 'New account (bulk)';
    case 'customer_crm_topup':
    case 'customer_topup':
      return 'Top-up';
    case 'create_account':
      return 'New account';
    default:
      return 'New account';
  }
}

export function customerHistoryServiceLabel(serviceTag) {
  return serviceTag ? getServiceTagShortLabel(serviceTag) : '—';
}
