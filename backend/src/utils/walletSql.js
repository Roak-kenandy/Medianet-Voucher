/**
 * Completed operator spend: excludes staff corrections (negative admin adjustments are stored as
 * debits) and charges that were refunded after a failed CRM activation.
 */
export function operatorSpendDebitSql(alias = 'wt') {
  const a = alias ? `${alias}.` : '';
  return `(${a}type = 'debit'
    AND ${a}status = 'completed'
    AND COALESCE(${a}created_by_type, '') <> 'admin'
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${a}metadata, '$.crmState')), '') <> 'refunded')`;
}
