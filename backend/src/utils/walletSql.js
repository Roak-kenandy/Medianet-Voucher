/**
 * Completed operator spend: excludes staff corrections (negative admin adjustments are stored as
 * debits) and charges that were refunded after a failed CRM activation.
 */
/**
 * Staff reports and dashboard figures cover live operators only: sandbox operators make test
 * sales against the CRM sandbox with test balance, which is not business activity.
 * `operatorIdColumn` is the column holding the operator id (e.g. `wt.operator_id`, `o.id`).
 */
export function liveOperatorSql(operatorIdColumn) {
  return `${operatorIdColumn} IN (SELECT id FROM operators WHERE environment = 'live')`;
}

export function operatorSpendDebitSql(alias = 'wt') {
  const a = alias ? `${alias}.` : '';
  return `(${a}type = 'debit'
    AND ${a}status = 'completed'
    AND COALESCE(${a}created_by_type, '') <> 'admin'
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${a}metadata, '$.crmState')), '') <> 'refunded')`;
}
