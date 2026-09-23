import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { buildDailyTrend } from '../utils/chartData.js';
import {
  computeDealerTopupSummary,
  forEachDealerTopupBatch,
} from './dealerTopupReportService.js';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function toDateKey(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function buildWalletDateFilters({ startDate, endDate }, params, operatorId) {
  const filters = [`wt.status = 'completed'`];
  if (operatorId) {
    filters.push('wt.operator_id = ?');
    params.push(operatorId);
  }
  if (startDate) {
    filters.push('DATE(COALESCE(wt.completed_at, wt.created_at)) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    filters.push('DATE(COALESCE(wt.completed_at, wt.created_at)) <= ?');
    params.push(endDate);
  }
  return filters;
}

function buildAccountDateFilters({ startDate, endDate }, params, operatorId) {
  const filters = ['1=1'];
  if (operatorId) {
    filters.push('va.operator_id = ?');
    params.push(operatorId);
  }
  if (startDate) {
    filters.push('va.created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    filters.push('va.created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }
  return filters;
}

function emptyOperatorBucket(row) {
  return {
    operatorId: row.operatorId,
    operatorName: row.operatorName || row.clientName,
    operatorEmail: row.operatorEmail || row.email || '',
    onlineTopups: 0,
    manualTopups: 0,
    amountPaid: 0,
    gstAmount: 0,
    credited: 0,
    commission: 0,
    walletSpend: 0,
    customerActions: 0,
    accountsCreated: 0,
    amountCharged: 0,
  };
}

function foldTopupRowsIntoOperators(byOperator, mappedRows) {
  for (const row of mappedRows) {
    const key = row.operatorId;
    if (!byOperator.has(key)) {
      byOperator.set(key, emptyOperatorBucket(row));
    }
    const bucket = byOperator.get(key);
    bucket.operatorName = row.operator;
    bucket.operatorEmail = row.operatorEmail;
    if (row.source === 'Manual activation') {
      bucket.manualTopups += 1;
    } else {
      bucket.onlineTopups += 1;
    }
    bucket.amountPaid = roundMoney(bucket.amountPaid + row.amountPaid);
    bucket.gstAmount = roundMoney(bucket.gstAmount + row.gstAmount);
    bucket.credited = roundMoney(bucket.credited + row.credited);
    bucket.commission = roundMoney(bucket.commission + row.commission);
  }
}

export async function generateSalesReport({ operatorId, startDate, endDate } = {}) {
  const byOperator = new Map();
  await forEachDealerTopupBatch({ operatorId, startDate, endDate }, (mapped) => {
    foldTopupRowsIntoOperators(byOperator, mapped);
  });

  const debitParams = [];
  const debitFilters = buildWalletDateFilters({ startDate, endDate }, debitParams, operatorId);
  debitFilters.push(`wt.type = 'debit'`);

  const debitRows = await query(
    `SELECT wt.operator_id AS operatorId,
            o.client_name AS operatorName,
            o.email AS operatorEmail,
            COUNT(*) AS customerActions,
            COALESCE(SUM(wt.net_amount), 0) AS walletSpend
     FROM wallet_transactions wt
     INNER JOIN operators o ON o.id = wt.operator_id
     WHERE ${debitFilters.join(' AND ')}
     GROUP BY wt.operator_id, o.client_name, o.email`,
    debitParams
  );

  const accountParams = [];
  const accountFilters = buildAccountDateFilters({ startDate, endDate }, accountParams, operatorId);

  const accountRows = await query(
    `SELECT va.operator_id AS operatorId,
            o.client_name AS operatorName,
            o.email AS operatorEmail,
            COUNT(*) AS accountsCreated,
            COALESCE(SUM(va.amount_charged), 0) AS amountCharged
     FROM voucher_accounts va
     INNER JOIN operators o ON o.id = va.operator_id
     WHERE ${accountFilters.join(' AND ')}
     GROUP BY va.operator_id, o.client_name, o.email`,
    accountParams
  );

  for (const row of debitRows) {
    const key = row.operatorId;
    if (!byOperator.has(key)) {
      byOperator.set(key, emptyOperatorBucket(row));
    }
    const bucket = byOperator.get(key);
    bucket.walletSpend = roundMoney(Number(row.walletSpend) || 0);
    bucket.customerActions = Number(row.customerActions) || 0;
  }

  for (const row of accountRows) {
    const key = row.operatorId;
    if (!byOperator.has(key)) {
      byOperator.set(key, emptyOperatorBucket(row));
    }
    const bucket = byOperator.get(key);
    bucket.accountsCreated = Number(row.accountsCreated) || 0;
    bucket.amountCharged = roundMoney(Number(row.amountCharged) || 0);
  }

  const rows = [...byOperator.values()].sort((a, b) => b.amountPaid - a.amountPaid);

  const summary = {
    operatorsWithActivity: rows.length,
    totalOnlineTopups: rows.reduce((sum, row) => sum + row.onlineTopups, 0),
    totalManualTopups: rows.reduce((sum, row) => sum + row.manualTopups, 0),
    totalAmountPaid: roundMoney(rows.reduce((sum, row) => sum + row.amountPaid, 0)),
    totalGstAmount: roundMoney(rows.reduce((sum, row) => sum + row.gstAmount, 0)),
    totalCredited: roundMoney(rows.reduce((sum, row) => sum + row.credited, 0)),
    totalCommission: roundMoney(rows.reduce((sum, row) => sum + row.commission, 0)),
    totalWalletSpend: roundMoney(rows.reduce((sum, row) => sum + row.walletSpend, 0)),
    totalCustomerActions: rows.reduce((sum, row) => sum + row.customerActions, 0),
    totalAccountsCreated: rows.reduce((sum, row) => sum + row.accountsCreated, 0),
    totalAmountCharged: roundMoney(rows.reduce((sum, row) => sum + row.amountCharged, 0)),
    currencyCode: config.wallet.currencyCode,
    gstRatePercent: roundMoney(config.wallet.gstRate * 100),
  };

  return {
    reportType: 'sales_report',
    generatedAt: new Date().toISOString(),
    filters: { operatorId: operatorId || null, startDate: startDate || null, endDate: endDate || null },
    summary,
    rows,
  };
}

export async function getSalesDashboardStats({ days = 30 } = {}) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const topupSummary = await computeDealerTopupSummary({ startDate, endDate });
  const report = await generateSalesReport({ startDate, endDate });

  const topupByDay = new Map();
  await forEachDealerTopupBatch({ startDate, endDate }, (mapped) => {
    for (const row of mapped) {
      const key = toDateKey(row.completedAt);
      topupByDay.set(key, roundMoney((topupByDay.get(key) || 0) + row.amountPaid));
    }
  });

  const debitParams = [];
  const debitFilters = buildWalletDateFilters({ startDate, endDate }, debitParams, null);
  debitFilters.push(`wt.type = 'debit'`);

  const debitTrendRows = await query(
    `SELECT DATE(COALESCE(wt.completed_at, wt.created_at)) AS date,
            COALESCE(SUM(wt.net_amount), 0) AS amount
     FROM wallet_transactions wt
     WHERE ${debitFilters.join(' AND ')}
     GROUP BY DATE(COALESCE(wt.completed_at, wt.created_at))
     ORDER BY date ASC`,
    debitParams
  );

  const topupTrend = buildDailyTrend(
    [...topupByDay.entries()].map(([date, count]) => ({ date, count })),
    days
  );
  const spendTrend = buildDailyTrend(
    debitTrendRows.map((row) => ({ date: row.date, count: roundMoney(Number(row.amount) || 0) })),
    days
  );

  const topOperatorsBySales = report.rows.slice(0, 8).map((row) => ({
    clientName: row.operatorName,
    topupPaid: row.amountPaid,
    walletSpend: row.walletSpend,
    accountsCreated: row.accountsCreated,
  }));

  return {
    periodDays: days,
    startDate,
    endDate,
    ...report.summary,
    totalAmountPaid: topupSummary.totalAmountPaid,
    totalCredited: topupSummary.totalCredited,
    totalGstAmount: topupSummary.totalGstAmount,
    totalCommission: topupSummary.totalCommission,
    charts: {
      topupCollectedTrend: topupTrend,
      walletSpendTrend: spendTrend,
      topOperatorsBySales,
    },
  };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function salesReportToCsv(report) {
  const headers = [
    'Operator',
    'Operator Email',
    'Online Top-ups',
    'Manual Top-ups',
    'Amount Paid',
    'GST',
    'Credited',
    'Commission',
    'Wallet Spend',
    'Customer Actions',
    'Accounts Created',
    'Amount Charged',
  ];

  const lines = [
    'Medianet Voucher — Sales Report',
    `Generated,${report.generatedAt}`,
    `Period,${report.filters.startDate || 'all'} to ${report.filters.endDate || 'all'}`,
    '',
    'Summary',
    `Operators With Activity,${report.summary.operatorsWithActivity}`,
    `Total Amount Paid,${report.summary.totalAmountPaid}`,
    `Total GST,${report.summary.totalGstAmount}`,
    `Total Credited,${report.summary.totalCredited}`,
    `Total Commission,${report.summary.totalCommission}`,
    `Total Wallet Spend,${report.summary.totalWalletSpend}`,
    `Total Accounts Created,${report.summary.totalAccountsCreated}`,
    `Total Amount Charged,${report.summary.totalAmountCharged}`,
    `Currency,${report.summary.currencyCode}`,
    '',
    headers.join(','),
  ];

  for (const row of report.rows) {
    lines.push(
      [
        row.operatorName,
        row.operatorEmail,
        row.onlineTopups,
        row.manualTopups,
        row.amountPaid,
        row.gstAmount,
        row.credited,
        row.commission,
        row.walletSpend,
        row.customerActions,
        row.accountsCreated,
        row.amountCharged,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\ufeff${lines.join('\n')}`;
}

export async function streamSalesReportCsv(res, filters) {
  const report = await generateSalesReport(filters);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
  res.write(salesReportToCsv(report));
  res.end();
}
