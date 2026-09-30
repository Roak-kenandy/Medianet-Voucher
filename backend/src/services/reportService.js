import { query } from '../db/pool.js';
import { calculateGstFromTotal } from './walletService.js';
import { config } from '../config/index.js';
import {
  getDealerTopupReportPaginated,
  dealerTopupReportToCsv,
  streamDealerTopupReportCsv,
} from './dealerTopupReportService.js';
import { generateSalesReport, salesReportToCsv, streamSalesReportCsv } from './salesReportService.js';
import { REPORT_DEFAULT_PAGE_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';
import { streamCsvFromOffsetBatches } from './reportPagination.js';
import { csvEscape, csvRow } from '../utils/csv.js';

const PAGINATED_REPORT_TYPES = new Set(['dealer_topup', 'customer_summary']);

export function isPaginatedReportType(reportType) {
  return PAGINATED_REPORT_TYPES.has(reportType);
}

export async function generateReport({
  operatorId,
  packageType,
  startDate,
  endDate,
  reportType,
  page,
  limit,
  search,
}) {
  const pageNum = page || 1;
  const limitNum = limit || REPORT_DEFAULT_PAGE_SIZE;
  const includeSummary = pageNum === 1;

  if (reportType === 'dealer_topup') {
    return getDealerTopupReportPaginated(
      { operatorId, startDate, endDate },
      { page: pageNum, limit: limitNum, search: search || '', includeSummary }
    );
  }
  if (reportType === 'sales_report') {
    return generateSalesReport({ operatorId, startDate, endDate });
  }
  if (reportType === 'accounts_by_period') {
    return accountsByPeriodReport({ operatorId, packageType, startDate, endDate });
  }
  if (reportType === 'package_breakdown') {
    return packageBreakdownReport({ startDate, endDate });
  }
  if (reportType === 'customer_summary') {
    return customerSummaryReport(
      { operatorId, packageType, startDate, endDate },
      { page: pageNum, limit: limitNum, search: search || '', includeSummary }
    );
  }
  return clientSummaryReport({ operatorId, packageType, startDate, endDate });
}

const CUSTOMER_LEDGER_ACTIVITIES = [
  'create_account',
  'customer_subscribe',
  'customer_crm_topup',
  'customer_topup',
  'bulk_create',
];

function formatLedgerDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function readMeta(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function areaLabel(tag) {
  if (tag === 'MEDIANET_TV') return 'Medianet TV';
  if (tag === 'OTT') return 'Mobile';
  return tag || '';
}

function buildCustomerSummaryFilters({ operatorId, packageType, startDate, endDate }, search) {
  const filters = [
    `wt.status = 'completed'`,
    `(
      (wt.type = 'debit' AND JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity')) IN (${CUSTOMER_LEDGER_ACTIVITIES.map(() => '?').join(', ')}))
      OR wt.type = 'refund'
    )`,
  ];
  const params = [...CUSTOMER_LEDGER_ACTIVITIES];

  if (startDate) {
    filters.push('COALESCE(wt.completed_at, wt.created_at) >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    filters.push('COALESCE(wt.completed_at, wt.created_at) <= ?');
    params.push(`${endDate} 23:59:59`);
  }
  if (operatorId) {
    filters.push('wt.operator_id = ?');
    params.push(operatorId);
  }
  if (packageType) {
    filters.push(`(
      JSON_SEARCH(wt.metadata, 'one', ?, NULL, '$.packageNames') IS NOT NULL
      OR JSON_SEARCH(orig.metadata, 'one', ?, NULL, '$.packageNames') IS NOT NULL
    )`);
    params.push(packageType, packageType);
  }

  const term = search?.trim();
  if (term) {
    const like = `%${term}%`;
    filters.push(`(
      o.client_name LIKE ?
      OR o.email LIKE ?
      OR va.full_name LIKE ?
      OR va.phone_number LIKE ?
      OR va.external_ref LIKE ?
      OR wt.reference LIKE ?
      OR JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.customerName')) LIKE ?
      OR JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.phoneNumber')) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }

  return { filters, params, where: `WHERE ${filters.join(' AND ')}` };
}

const CUSTOMER_SUMMARY_SELECT = `SELECT
       wt.id,
       wt.type,
       wt.net_amount AS netAmount,
       wt.reference,
       wt.metadata,
       wt.created_at AS createdAt,
       wt.completed_at AS completedAt,
       orig.metadata AS originalMetadata,
       o.client_name AS operatorName,
       o.email AS operatorEmail,
       va.full_name AS accountName,
       va.phone_number AS phoneNumber,
       va.external_ref AS externalRef,
       va.service_tag AS accountServiceTag`;

const CUSTOMER_SUMMARY_FROM = `FROM wallet_transactions wt
     JOIN operators o ON o.id = wt.operator_id
     LEFT JOIN wallet_transactions orig
       ON wt.type = 'refund'
      AND orig.reference = JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.refundOf'))
     LEFT JOIN voucher_accounts va
       ON va.id = COALESCE(wt.voucher_account_id, orig.voucher_account_id)`;

const CUSTOMER_SUMMARY_ORDER = `ORDER BY COALESCE(wt.completed_at, wt.created_at) DESC, wt.id DESC`;

export function mapCustomerLedgerRow(row) {
  const metadata = readMeta(row.metadata);
  const original = readMeta(row.originalMetadata);
  const total = Math.round(Number(row.netAmount) * 100) / 100;
  const signedTotal = row.type === 'refund' ? -Math.abs(total) : Math.abs(total);
  const split = calculateGstFromTotal(Math.abs(signedTotal), config.wallet.gstRate);
  const sign = signedTotal < 0 ? -1 : 1;
  const amount = Math.round(sign * split.afterGst * 100) / 100;
  const serviceTag = metadata.serviceTag || original.serviceTag || row.accountServiceTag || '';

  return {
    date: formatLedgerDate(row.completedAt || row.createdAt),
    user: row.operatorEmail || '',
    dealer: row.operatorName || '',
    account: row.externalRef || metadata.phoneNumber || original.phoneNumber || row.phoneNumber || '',
    area: areaLabel(serviceTag),
    customerName: metadata.customerName || original.customerName || row.accountName || '',
    atoll: '',
    island: '',
    ward: '',
    street: '',
    address: '',
    paymentMethod: 'Wallet',
    action: signedTotal < 0 ? 'Deduct' : 'Add',
    amount,
    gst: Math.round((signedTotal - amount) * 100) / 100,
    total: signedTotal,
    receipt: row.reference || '',
  };
}

async function customerSummaryReport(filters, { page, limit, search, includeSummary }) {
  const { params, where } = buildCustomerSummaryFilters(filters, search);

  const [countRow] = await query(
    `SELECT COUNT(*) AS total
     ${CUSTOMER_SUMMARY_FROM}
     ${where}`,
    params
  );
  const total = Number(countRow.total) || 0;

  const { page: pageNum, limit: limitNum, clause: pageClause } = paginationSql(page, limit, 100);

  const rows = await query(
    `${CUSTOMER_SUMMARY_SELECT}
     ${CUSTOMER_SUMMARY_FROM}
     ${where}
     ${CUSTOMER_SUMMARY_ORDER}
     ${pageClause}`,
    params
  );

  const mapped = rows.map(mapCustomerLedgerRow);

  let summary = null;
  if (includeSummary) {
    const summaryFilters = buildCustomerSummaryFilters(filters, '');
    const [summaryRow] = await query(
      `SELECT
         COUNT(*) AS totalPayments,
         SUM(CASE WHEN wt.type = 'debit' THEN 1 ELSE 0 END) AS addCount,
         SUM(CASE WHEN wt.type = 'refund' THEN 1 ELSE 0 END) AS deductCount,
         COALESCE(SUM(CASE WHEN wt.type = 'refund' THEN -wt.net_amount ELSE wt.net_amount END), 0) AS netTotal
       ${CUSTOMER_SUMMARY_FROM}
       ${summaryFilters.where}`,
      summaryFilters.params
    );
    const netTotal = Math.round(Number(summaryRow.netTotal) * 100) / 100;
    const split = calculateGstFromTotal(Math.abs(netTotal), config.wallet.gstRate);
    const sign = netTotal < 0 ? -1 : 1;
    const netAmount = Math.round(sign * split.afterGst * 100) / 100;
    summary = {
      totalPayments: Number(summaryRow.totalPayments) || 0,
      addCount: Number(summaryRow.addCount) || 0,
      deductCount: Number(summaryRow.deductCount) || 0,
      netAmount,
      netGst: Math.round((netTotal - netAmount) * 100) / 100,
      netTotal,
      currencyCode: config.wallet.currencyCode,
    };
  }

  return {
    reportType: 'customer_summary',
    generatedAt: new Date().toISOString(),
    filters: { ...filters, search: search?.trim() || null },
    rows: mapped,
    summary,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum) || 1),
    },
  };
}

async function clientSummaryReport({ operatorId, packageType, startDate, endDate }) {
  const filters = [];
  const params = [];

  if (operatorId) {
    filters.push('o.id = ?');
    params.push(operatorId);
  }
  if (packageType) {
    filters.push('o.package_type = ?');
    params.push(packageType);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const periodSubquery = buildPeriodSubquery(startDate, endDate);

  const rows = await query(
    `SELECT
       o.id AS operatorId,
       o.client_name AS clientName,
       o.package_type AS packageType,
       o.email,
       o.account_quota AS accountQuota,
       o.accounts_created AS accountsCreated,
       o.is_active AS isActive,
       ${periodSubquery.select}
     FROM operators o
     ${periodSubquery.join}
     ${where}
     GROUP BY o.id, o.client_name, o.package_type, o.email, o.account_quota, o.accounts_created, o.is_active
     ORDER BY o.client_name ASC`,
    [...periodSubquery.params, ...params]
  );

  return {
    reportType: 'client_summary',
    generatedAt: new Date().toISOString(),
    filters: { operatorId, packageType, startDate, endDate },
    rows,
    summary: {
      totalClients: rows.length,
      totalAccountsCreated: rows.reduce((s, r) => s + Number(r.accountsCreated), 0),
      totalInPeriod: rows.reduce((s, r) => s + Number(r.recordsInPeriod || 0), 0),
    },
  };
}

async function accountsByPeriodReport({ operatorId, packageType, startDate, endDate }) {
  const filters = ['1=1'];
  const params = [];

  if (startDate) {
    filters.push('va.created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    filters.push('va.created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }
  if (operatorId) {
    filters.push('o.id = ?');
    params.push(operatorId);
  }
  if (packageType) {
    filters.push('o.package_type = ?');
    params.push(packageType);
  }

  const rows = await query(
    `SELECT
       DATE(va.created_at) AS date,
       o.client_name AS clientName,
       o.package_type AS packageType,
       COUNT(*) AS totalAccounts,
       SUM(CASE WHEN va.status = 'created' THEN 1 ELSE 0 END) AS created,
       SUM(CASE WHEN va.status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM voucher_accounts va
     JOIN operators o ON o.id = va.operator_id
     WHERE ${filters.join(' AND ')}
     GROUP BY DATE(va.created_at), o.id, o.client_name, o.package_type
     ORDER BY date DESC, o.client_name ASC`,
    params
  );

  return {
    reportType: 'accounts_by_period',
    generatedAt: new Date().toISOString(),
    filters: { operatorId, packageType, startDate, endDate },
    rows,
  };
}

async function packageBreakdownReport({ startDate, endDate }) {
  const dateFilters = [];
  const params = [];

  if (startDate) {
    dateFilters.push('va.created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    dateFilters.push('va.created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }

  const vaJoin = dateFilters.length
    ? `LEFT JOIN voucher_accounts va ON va.operator_id = o.id AND ${dateFilters.join(' AND ')}`
    : 'LEFT JOIN voucher_accounts va ON va.operator_id = o.id';

  const rows = await query(
    `SELECT
       o.package_type AS packageType,
       COUNT(DISTINCT o.id) AS operatorCount,
       COUNT(va.id) AS totalAccounts,
       SUM(CASE WHEN va.status = 'created' THEN 1 ELSE 0 END) AS createdAccounts,
       SUM(o.accounts_created) AS lifetimeAccountsCreated
     FROM operators o
     ${vaJoin}
     GROUP BY o.package_type
     ORDER BY totalAccounts DESC`,
    params
  );

  return {
    reportType: 'package_breakdown',
    generatedAt: new Date().toISOString(),
    filters: { startDate, endDate },
    rows,
  };
}

function buildPeriodSubquery(startDate, endDate) {
  if (!startDate && !endDate) {
    return {
      join: `LEFT JOIN voucher_accounts va ON va.operator_id = o.id`,
      select: `COUNT(va.id) AS recordsInPeriod,
               SUM(CASE WHEN va.status = 'created' THEN 1 ELSE 0 END) AS createdInPeriod,
               SUM(CASE WHEN va.status = 'pending' THEN 1 ELSE 0 END) AS pendingInPeriod,
               SUM(CASE WHEN va.status = 'failed' THEN 1 ELSE 0 END) AS failedInPeriod`,
      params: [],
    };
  }

  const conditions = [];
  const params = [];
  if (startDate) {
    conditions.push('va.created_at >= ?');
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    conditions.push('va.created_at <= ?');
    params.push(`${endDate} 23:59:59`);
  }

  return {
    join: `LEFT JOIN voucher_accounts va ON va.operator_id = o.id AND ${conditions.join(' AND ')}`,
    select: `COUNT(va.id) AS recordsInPeriod,
             SUM(CASE WHEN va.status = 'created' THEN 1 ELSE 0 END) AS createdInPeriod,
             SUM(CASE WHEN va.status = 'pending' THEN 1 ELSE 0 END) AS pendingInPeriod,
             SUM(CASE WHEN va.status = 'failed' THEN 1 ELSE 0 END) AS failedInPeriod`,
    params,
  };
}

export function reportToCsv(report) {
  if (report.reportType === 'dealer_topup') {
    return dealerTopupReportToCsv(report);
  }
  if (report.reportType === 'sales_report') {
    return salesReportToCsv(report);
  }

  if (!report.rows?.length) return 'No data';

  const headers = Object.keys(report.rows[0]);
  const lines = [
    csvRow(headers),
    ...report.rows.map((row) => csvRow(headers.map((h) => row[h] ?? ''))),
  ];
  return lines.join('\n');
}

export async function streamReportExport(res, filters) {
  const { reportType } = filters;

  if (reportType === 'dealer_topup') {
    await streamDealerTopupReportCsv(res, filters);
    return;
  }

  if (reportType === 'sales_report') {
    await streamSalesReportCsv(res, filters);
    return;
  }

  if (reportType === 'customer_summary') {
    const { params, where } = buildCustomerSummaryFilters(filters, '');
    const [summaryRow] = await query(
      `SELECT COUNT(*) AS totalPayments
       ${CUSTOMER_SUMMARY_FROM}
       ${where}`,
      params
    );

    const titleLines = [
      'Medianet Voucher — Customer Summary',
      `Generated,${new Date().toISOString()}`,
      `Period,${filters.startDate || 'all'} to ${filters.endDate || 'all'}`,
      '',
      `Payments,${Number(summaryRow.totalPayments) || 0}`,
      '',
    ];

    const headers = [
      'Date',
      'User',
      'Dealer',
      'Account',
      'Area',
      'Customer name',
      'Atoll',
      'Island',
      'Ward',
      'Street',
      'Address',
      'Payment method',
      'Action',
      'Amount',
      'GST',
      'Total',
      '#Receipt',
    ];

    await streamCsvFromOffsetBatches(res, {
      filename: 'report-customer_summary.csv',
      titleLines,
      headers,
      rowToCells: (row) => {
        const mapped = mapCustomerLedgerRow(row);
        return [
          mapped.date,
          mapped.user,
          mapped.dealer,
          mapped.account,
          mapped.area,
          mapped.customerName,
          mapped.atoll,
          mapped.island,
          mapped.ward,
          mapped.street,
          mapped.address,
          mapped.paymentMethod,
          mapped.action,
          mapped.amount,
          mapped.gst,
          mapped.total,
          mapped.receipt,
        ];
      },
      countSql: `SELECT COUNT(*) AS total ${CUSTOMER_SUMMARY_FROM} ${where}`,
      countParams: params,
      batchSql: `${CUSTOMER_SUMMARY_SELECT} ${CUSTOMER_SUMMARY_FROM} ${where} ${CUSTOMER_SUMMARY_ORDER}`,
      batchParams: params,
    });
    return;
  }

  const report = await generateReport({ ...filters, page: 1, limit: 100000 });
  const csv = reportToCsv(report);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report-${reportType}.csv"`);
  res.send(csv);
}
