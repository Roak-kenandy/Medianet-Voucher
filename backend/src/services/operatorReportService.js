import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

function buildDateFilters(startDate, endDate, column = 'va.created_at') {
  const conditions = [];
  const params = [];

  if (startDate) {
    conditions.push(`${column} >= ?`);
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    conditions.push(`${column} <= ?`);
    params.push(`${endDate} 23:59:59`);
  }

  return { conditions, params, clause: conditions.length ? conditions.join(' AND ') : null };
}

export async function generateOperatorReport(operatorId, { startDate, endDate } = {}) {
  const [operator] = await query(
    `SELECT id, client_name, package_type, email, account_quota, accounts_created
     FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const { conditions, params, clause } = buildDateFilters(startDate, endDate);
  const dateWhere = clause ? `AND ${clause}` : '';

  const rows = await query(
    `SELECT
       full_name AS fullName,
       phone_number AS phoneNumber,
       status,
       created_at AS createdAt
     FROM voucher_accounts va
     WHERE operator_id = ? ${dateWhere}
     ORDER BY created_at DESC`,
    [operatorId, ...params]
  );

  const [statusCounts] = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'created' THEN 1 ELSE 0 END) AS created,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM voucher_accounts va
     WHERE operator_id = ? ${dateWhere}`,
    [operatorId, ...params]
  );

  const remaining = Math.max(0, operator.account_quota - operator.accounts_created);

  return {
    reportType: 'operator_activity',
    generatedAt: new Date().toISOString(),
    filters: { startDate, endDate },
    summary: {
      clientName: operator.client_name,
      packageType: operator.package_type,
      email: operator.email,
      accountQuota: operator.account_quota,
      accountsCreated: operator.accounts_created,
      remainingQuota: remaining,
      recordsInPeriod: Number(statusCounts.total),
      createdInPeriod: Number(statusCounts.created),
      pendingInPeriod: Number(statusCounts.pending),
      failedInPeriod: Number(statusCounts.failed),
    },
    rows: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    })),
  };
}

export function operatorReportToCsv(report) {
  const lines = [
    'Operator Activity Report',
    `Client,${report.summary.clientName}`,
    `Package,${report.summary.packageType}`,
    `Quota,${report.summary.accountQuota}`,
    `Used,${report.summary.accountsCreated}`,
    `Remaining,${report.summary.remainingQuota}`,
    `Period Records,${report.summary.recordsInPeriod}`,
    '',
  ];

  if (!report.rows?.length) {
    lines.push('No account records for selected period');
    return lines.join('\n');
  }

  const headers = ['Full Name', 'Phone Number', 'Status', 'Created At'];
  lines.push(headers.join(','));
  report.rows.forEach((row) => {
    lines.push(
      [row.fullName, row.phoneNumber, row.status, row.createdAt]
        .map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
  });

  return lines.join('\n');
}
