import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { getOperatorPackages } from './packageService.js';

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
    `SELECT o.id, o.client_name, o.package_type, o.email, o.wallet_balance, o.accounts_created
     FROM operators o
     WHERE o.id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const packages = await getOperatorPackages(operatorId);
  const packageType = packages.map((pkg) => pkg.name).join(', ') || operator.package_type;

  const { conditions, params, clause } = buildDateFilters(startDate, endDate);
  const dateWhere = clause ? `AND ${clause}` : '';

  const rows = await query(
    `SELECT
       full_name AS fullName,
       phone_number AS phoneNumber,
       status,
       amount_charged AS amountCharged,
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
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       COALESCE(SUM(CASE WHEN status = 'created' THEN amount_charged ELSE 0 END), 0) AS spent
     FROM voucher_accounts va
     WHERE operator_id = ? ${dateWhere}`,
    [operatorId, ...params]
  );

  const walletBalance = Math.round(Number(operator.wallet_balance) * 100) / 100;

  return {
    reportType: 'operator_activity',
    generatedAt: new Date().toISOString(),
    filters: { startDate, endDate },
    summary: {
      clientName: operator.client_name,
      packageType,
      email: operator.email,
      walletBalance,
      currencyCode: config.wallet.currencyCode,
      accountsCreated: operator.accounts_created,
      recordsInPeriod: Number(statusCounts.total),
      createdInPeriod: Number(statusCounts.created),
      pendingInPeriod: Number(statusCounts.pending),
      failedInPeriod: Number(statusCounts.failed),
      spentInPeriod: Math.round(Number(statusCounts.spent) * 100) / 100,
    },
    rows: rows.map((row) => ({
      ...row,
      amountCharged: row.amountCharged != null ? Number(row.amountCharged) : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    })),
  };
}

export function operatorReportToCsv(report) {
  const lines = [
    'Operator Activity Report',
    `Client,${report.summary.clientName}`,
    `Package,${report.summary.packageType}`,
    `Wallet Balance,${report.summary.walletBalance}`,
    `Accounts Created,${report.summary.accountsCreated}`,
    `Spent In Period,${report.summary.spentInPeriod}`,
    `Period Records,${report.summary.recordsInPeriod}`,
    '',
  ];

  if (!report.rows?.length) {
    lines.push('No account records for selected period');
    return lines.join('\n');
  }

  const headers = ['Full Name', 'Phone Number', 'Status', 'Amount Charged', 'Created At'];
  lines.push(headers.join(','));
  report.rows.forEach((row) => {
    lines.push(
      [row.fullName, row.phoneNumber, row.status, row.amountCharged ?? '', row.createdAt]
        .map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
  });

  return lines.join('\n');
}
