import { query } from '../db/pool.js';
import { resolveWalletTransactionBalances } from './walletService.js';
import { csvEscape } from '../utils/csv.js';
import {
  REPORT_SCAN_BATCH_SIZE,
  REPORT_MAX_WALLET_TX_EXPORT_ROWS,
} from '../constants/reportLimits.js';
import { AppError } from '../utils/errors.js';

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatActivityLabel(metadata = {}) {
  if (metadata.activity === 'create_account') return 'Create Account';
  if (metadata.activity === 'customer_crm_topup') return 'Customer Top-up';
  if (metadata.activity === 'customer_subscribe') return 'Customer Subscribe';
  if (metadata.activity === 'customer_topup') return 'Customer Top-up';
  if (metadata.activity === 'bulk_create') return 'Bulk Create';
  return '';
}

function mapTransactionRow(row) {
  const metadata = parseMetadata(row.metadata);
  const activity = formatActivityLabel(metadata) || (row.type === 'topup' ? 'Wallet Top-up' : row.type);
  const { balanceBefore, balanceAfter, netAmount } = resolveWalletTransactionBalances(row);

  return {
    id: row.id,
    date: row.created_at,
    completedAt: row.completed_at,
    type: row.type,
    status: row.status,
    activity,
    amount: Number(row.amount) || 0,
    commissionAmount: Number(row.commission_amount) || 0,
    netAmount,
    balanceBefore,
    balanceAfter,
    currencyCode: row.currency_code || 'MVR',
    reference: row.reference,
    paymentRef: row.payment_ref,
    description: row.description,
    customerName: metadata.customerName || null,
    phoneNumber: metadata.phoneNumber || null,
    serviceTag: metadata.serviceTag || null,
    packageNames: metadata.packageNames || [],
    packageIds: metadata.packageIds || [],
    voucherAccountId: row.voucher_account_id,
  };
}

function buildDateFilters({ startDate, endDate }, params) {
  const filters = ['wt.operator_id = ?'];
  if (startDate) {
    filters.push('DATE(wt.created_at) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    filters.push('DATE(wt.created_at) <= ?');
    params.push(endDate);
  }
  return filters;
}

export async function generateWalletTransactionReport(operatorId, { startDate, endDate, type } = {}) {
  const params = [operatorId];
  const filters = buildDateFilters({ startDate, endDate }, params);

  if (type) {
    filters.push('wt.type = ?');
    params.push(type);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const rows = await query(
    `SELECT wt.id, wt.type, wt.status, wt.amount, wt.commission_amount, wt.net_amount,
            wt.balance_before, wt.balance_after, wt.currency_code, wt.reference,
            wt.payment_ref, wt.description, wt.metadata, wt.voucher_account_id,
            wt.created_at, wt.completed_at
     FROM wallet_transactions wt
     ${where}
     ORDER BY wt.created_at DESC`,
    params
  );

  const mapped = rows.map(mapTransactionRow);

  const summary = {
    totalTransactions: mapped.length,
    totalTopups: mapped.filter((row) => row.type === 'topup' && row.status === 'completed').length,
    totalDebits: mapped.filter((row) => row.type === 'debit' && row.status === 'completed').length,
    totalCredited: mapped
      .filter((row) => row.type === 'topup' && row.status === 'completed')
      .reduce((sum, row) => sum + row.netAmount, 0),
    totalDebited: mapped
      .filter((row) => row.type === 'debit' && row.status === 'completed')
      .reduce((sum, row) => sum + row.netAmount, 0),
    createAccountCharges: mapped
      .filter((row) => row.activity === 'Create Account' && row.status === 'completed')
      .reduce((sum, row) => sum + row.netAmount, 0),
    customerTopupCharges: mapped
      .filter((row) => row.activity === 'Customer Top-up' && row.status === 'completed')
      .reduce((sum, row) => sum + row.netAmount, 0),
    currencyCode: mapped[0]?.currencyCode || 'MVR',
  };

  return {
    generatedAt: new Date().toISOString(),
    filters: { startDate: startDate || null, endDate: endDate || null, type: type || null },
    summary,
    rows: mapped,
  };
}

export function walletTransactionReportToCsv(report) {
  const lines = [
    'Medianet Voucher — Wallet Transaction Report',
    `Generated,${report.generatedAt}`,
    '',
    'Summary',
    `Total Transactions,${report.summary.totalTransactions}`,
    `Wallet Top-ups,${report.summary.totalTopups}`,
    `Customer Charges,${report.summary.totalDebits}`,
    `Total Credited,${report.summary.totalCredited}`,
    `Total Debited,${report.summary.totalDebited}`,
    `Create Account Charges,${report.summary.createAccountCharges}`,
    `Customer Top-up Charges,${report.summary.customerTopupCharges}`,
    '',
    [
      'Date',
      'Activity',
      'Type',
      'Status',
      'Customer Name',
      'Phone',
      'Packages',
      'Amount',
      'Net Amount',
      'Balance Before',
      'Balance After',
      'Reference',
      'Description',
    ].join(','),
  ];

  for (const row of report.rows) {
    lines.push(
      [
        new Date(row.date).toISOString(),
        row.activity,
        row.type,
        row.status,
        row.customerName || '',
        row.phoneNumber || '',
        (row.packageNames || []).join('; '),
        row.amount,
        row.netAmount,
        row.balanceBefore,
        row.balanceAfter,
        row.reference,
        row.description || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\ufeff${lines.join('\n')}`;
}

export async function streamWalletTransactionReportCsv(res, operatorId, filters = {}) {
  const params = [operatorId];
  const filterSql = buildDateFilters(filters, params);
  if (filters.type) {
    filterSql.push('wt.type = ?');
    params.push(filters.type);
  }
  const where = `WHERE ${filterSql.join(' AND ')}`;

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM wallet_transactions wt ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;
  if (total > REPORT_MAX_WALLET_TX_EXPORT_ROWS) {
    throw new AppError(
      `Export exceeds ${REPORT_MAX_WALLET_TX_EXPORT_ROWS} rows. Narrow the date range.`,
      400,
      'EXPORT_TOO_LARGE'
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wallet-transaction-report.csv"');
  res.write('\ufeff');
  res.write(
    [
      'Date',
      'Activity',
      'Type',
      'Status',
      'Customer Name',
      'Phone',
      'Packages',
      'Amount',
      'Net Amount',
      'Balance Before',
      'Balance After',
      'Reference',
      'Description',
    ]
      .map(csvEscape)
      .join(',') + '\n'
  );

  let lastId = null;
  let exported = 0;

  while (exported < total) {
    const batchParams = [...params];
    let batchWhere = where;
    if (lastId != null) {
      batchWhere += ' AND wt.id < ?';
      batchParams.push(lastId);
    }

    const rows = await query(
      `SELECT wt.id, wt.type, wt.status, wt.amount, wt.commission_amount, wt.net_amount,
              wt.balance_before, wt.balance_after, wt.currency_code, wt.reference,
              wt.payment_ref, wt.description, wt.metadata, wt.voucher_account_id,
              wt.created_at, wt.completed_at
       FROM wallet_transactions wt
       ${batchWhere}
       ORDER BY wt.id DESC
       LIMIT ?`,
      [...batchParams, REPORT_SCAN_BATCH_SIZE]
    );

    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      const mapped = mapTransactionRow(row);
      res.write(
        [
          new Date(mapped.date).toISOString(),
          mapped.activity,
          mapped.type,
          mapped.status,
          mapped.customerName || '',
          mapped.phoneNumber || '',
          (mapped.packageNames || []).join('; '),
          mapped.amount,
          mapped.netAmount,
          mapped.balanceBefore,
          mapped.balanceAfter,
          mapped.reference,
          mapped.description || '',
        ]
          .map(csvEscape)
          .join(',') + '\n'
      );
      exported += 1;
    }

    lastId = rows[rows.length - 1].id;
  }

  res.end();
}
