import { query } from '../db/pool.js';

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
  if (metadata.activity === 'customer_topup') return 'Customer Top-up';
  if (metadata.activity === 'bulk_create') return 'Bulk Create';
  return '';
}

function mapTransactionRow(row) {
  const metadata = parseMetadata(row.metadata);
  const activity = formatActivityLabel(metadata) || (row.type === 'topup' ? 'Wallet Top-up' : row.type);

  return {
    id: row.id,
    date: row.created_at,
    completedAt: row.completed_at,
    type: row.type,
    status: row.status,
    activity,
    amount: Number(row.amount) || 0,
    commissionAmount: Number(row.commission_amount) || 0,
    netAmount: Number(row.net_amount) || 0,
    balanceBefore: Number(row.balance_before) || 0,
    balanceAfter: Number(row.balance_after) || 0,
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

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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
