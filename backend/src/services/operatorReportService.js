import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { getOperatorPackages } from './packageService.js';
import { REPORT_DEFAULT_PAGE_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';
import { streamCsvFromOffsetBatches } from './reportPagination.js';

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

function buildSearchFilter(search) {
  const term = search?.trim();
  if (!term) return { clause: '', params: [] };
  const like = `%${term}%`;
  return {
    clause: 'AND (full_name LIKE ? OR phone_number LIKE ? OR status LIKE ?)',
    params: [like, like, like],
  };
}

export async function generateOperatorReport(
  operatorId,
  { startDate, endDate, page, limit, search } = {}
) {
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
  const { clause: searchClause, params: searchParams } = buildSearchFilter(search);

  const listParams = [operatorId, ...params, ...searchParams];

  const [countRow] = await query(
    `SELECT COUNT(*) AS total
     FROM voucher_accounts va
     WHERE operator_id = ? ${dateWhere} ${searchClause}`,
    listParams
  );
  const total = Number(countRow.total) || 0;

  const pageNum = page || 1;
  const includeSummary = pageNum === 1;
  const { page: safePage, limit: limitNum, clause: pageClause } = paginationSql(
    pageNum,
    limit || REPORT_DEFAULT_PAGE_SIZE,
    100
  );

  const rows = await query(
    `SELECT
       full_name AS fullName,
       phone_number AS phoneNumber,
       status,
       amount_charged AS amountCharged,
       created_at AS createdAt
     FROM voucher_accounts va
     WHERE operator_id = ? ${dateWhere} ${searchClause}
     ORDER BY created_at DESC
     ${pageClause}`,
    listParams
  );

  let summary = null;
  if (includeSummary) {
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

    summary = {
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
    };
  }

  return {
    reportType: 'operator_activity',
    generatedAt: new Date().toISOString(),
    filters: { startDate, endDate, search: search?.trim() || null },
    summary,
    rows: rows.map((row) => ({
      ...row,
      amountCharged: row.amountCharged != null ? Number(row.amountCharged) : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
    })),
    pagination: {
      page: safePage,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum) || 1),
    },
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
    'Full Name,Phone,Status,Amount Charged,Created At',
  ];

  for (const row of report.rows) {
    lines.push(
      [
        row.fullName,
        row.phoneNumber,
        row.status,
        row.amountCharged ?? '',
        row.createdAt,
      ].join(',')
    );
  }

  return lines.join('\n');
}

export async function streamOperatorReportCsv(res, operatorId, filters) {
  const report = await generateOperatorReport(operatorId, { ...filters, page: 1, limit: 1 });
  const { conditions, params, clause } = buildDateFilters(filters.startDate, filters.endDate);
  const dateWhere = clause ? `AND ${clause}` : '';

  const titleLines = report.summary
    ? [
        'Operator Activity Report',
        `Client,${report.summary.clientName}`,
        `Package,${report.summary.packageType}`,
        `Wallet Balance,${report.summary.walletBalance}`,
        `Period Records,${report.summary.recordsInPeriod}`,
        '',
      ]
    : ['Operator Activity Report', ''];

  await streamCsvFromOffsetBatches(res, {
    filename: 'operator-activity-report.csv',
    titleLines,
    headers: ['Full Name', 'Phone', 'Status', 'Amount Charged', 'Created At'],
    rowToCells: (row) => [
      row.fullName,
      row.phoneNumber,
      row.status,
      row.amountCharged ?? '',
      row.createdAt ? new Date(row.createdAt).toISOString() : '',
    ],
    countSql: `SELECT COUNT(*) AS total FROM voucher_accounts va WHERE operator_id = ? ${dateWhere}`,
    countParams: [operatorId, ...params],
    batchSql: `SELECT full_name AS fullName, phone_number AS phoneNumber, status,
                      amount_charged AS amountCharged, created_at AS createdAt
               FROM voucher_accounts va
               WHERE operator_id = ? ${dateWhere}
               ORDER BY created_at DESC`,
    batchParams: [operatorId, ...params],
  });
}
