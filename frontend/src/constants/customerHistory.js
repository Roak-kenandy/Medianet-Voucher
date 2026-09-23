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
  if (serviceTag === 'MEDIANET_TV') return 'Medianet TV';
  if (serviceTag === 'OTT') return 'Mobile';
  return serviceTag || '—';
}
