import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { calculateGstFromTotal } from './walletService.js';
import { REPORT_SCAN_BATCH_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatReportTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isManualStaffActivation(metadata) {
  return (
    metadata.activity === 'admin_operator_activation' ||
    metadata.source === 'admin_activation'
  );
}

export function resolveTopupFinancials(row, metadata) {
  if (isManualStaffActivation(metadata)) {
    const credited = roundMoney(row.net_amount ?? row.amount);
    return {
      amountPaid: credited,
      gstRate: 0,
      gstRatePercent: 0,
      gstAmount: 0,
      afterGst: credited,
      commissionAmount: 0,
      totalTopupAmount: credited,
    };
  }

  const defaultGstRate = config.wallet.gstRate;
  const amountPaid = roundMoney(metadata.amountPaid ?? row.amount);
  const commissionAmount = roundMoney(metadata.commissionAmount ?? row.commission_amount ?? 0);
  const totalTopupAmount = roundMoney(metadata.creditedAmount ?? row.net_amount);

  if (metadata.gstAmount != null || metadata.afterGst != null) {
    const afterGst = roundMoney(metadata.afterGst ?? totalTopupAmount - commissionAmount);
    const gstAmount = roundMoney(metadata.gstAmount ?? amountPaid - afterGst);
    const gstRate = metadata.gstRate ?? defaultGstRate;
    return {
      amountPaid,
      gstRate,
      gstRatePercent: roundMoney(metadata.gstRatePercent ?? gstRate * 100),
      gstAmount,
      afterGst,
      commissionAmount,
      totalTopupAmount,
    };
  }

  const gst = calculateGstFromTotal(amountPaid, defaultGstRate);

  return {
    amountPaid,
    gstRate: gst.gstRate,
    gstRatePercent: gst.gstRatePercent,
    gstAmount: gst.gstAmount,
    afterGst: gst.afterGst,
    commissionAmount,
    totalTopupAmount,
  };
}

function resolveProcessedBy(row, metadata, operatorEmail, adminEmail) {
  if (isManualStaffActivation(metadata)) {
    return metadata.staffEmail || adminEmail || metadata.staffName || 'Staff';
  }
  if (row.created_by_type === 'admin' && adminEmail) {
    return adminEmail;
  }
  if (row.created_by_type === 'operator' && operatorEmail) {
    return operatorEmail;
  }
  return operatorEmail || adminEmail || 'system';
}

function resolveTopupSource(row, metadata) {
  if (isManualStaffActivation(metadata)) {
    return 'Manual activation';
  }
  if (row.type === 'topup') {
    return 'Online (BML)';
  }
  return row.type || 'Other';
}

const TOPUP_SELECT = `SELECT wt.id, wt.type, wt.reference, wt.amount, wt.commission_amount, wt.net_amount,
            wt.payment_ref, wt.description, wt.metadata, wt.created_by_type, wt.created_by_id,
            wt.created_at, wt.completed_at, wt.currency_code,
            o.id AS operator_id, o.client_name, o.email AS operator_email,
            a.email AS admin_email, a.name AS admin_name`;

const TOPUP_FROM = `FROM wallet_transactions wt
     INNER JOIN operators o ON o.id = wt.operator_id
     LEFT JOIN admins a ON wt.created_by_type = 'admin' AND wt.created_by_id = a.id`;

const TOPUP_ORDER = `ORDER BY COALESCE(wt.completed_at, wt.created_at) DESC, wt.id DESC`;

export function buildDealerTopupBaseFilters({ operatorId, startDate, endDate } = {}) {
  const filters = [
    `wt.status = 'completed'`,
    `(
      wt.type = 'topup'
      OR (
        wt.type = 'adjustment'
        AND wt.net_amount > 0
        AND JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity')) = 'admin_operator_activation'
      )
    )`,
  ];
  const params = [];

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

  return { filters, params };
}

function buildDealerTopupSearchFilter(search) {
  const term = search?.trim();
  if (!term) {
    return { clause: '', params: [] };
  }
  const like = `%${term}%`;
  return {
    clause: `AND (
      o.client_name LIKE ?
      OR o.email LIKE ?
      OR wt.reference LIKE ?
      OR wt.payment_ref LIKE ?
      OR wt.description LIKE ?
    )`,
    params: [like, like, like, like, like],
  };
}

export function mapDealerTopupRow(row) {
  const metadata = parseMetadata(row.metadata);
  const financials = resolveTopupFinancials(row, metadata);
  const eventTime = row.completed_at || row.created_at;

  return {
    time: formatReportTime(eventTime),
    reference: row.reference || String(row.id),
    operator: row.client_name,
    operatorEmail: row.operator_email,
    amountPaid: financials.amountPaid,
    gstAmount: financials.gstAmount,
    afterGst: financials.afterGst,
    commission: financials.commissionAmount,
    credited: financials.totalTopupAmount,
    gstRatePercent: financials.gstRatePercent,
    source: resolveTopupSource(row, metadata),
    processedBy: resolveProcessedBy(row, metadata, row.operator_email, row.admin_email),
    paymentRef: row.payment_ref || '',
    operatorId: row.operator_id,
    currencyCode: row.currency_code || config.wallet.currencyCode,
    transactionId: row.id,
    completedAt: eventTime,
  };
}

export function createEmptyTopupSummary(currencyCode = config.wallet.currencyCode) {
  return {
    totalRecords: 0,
    uniqueOperators: 0,
    totalAmountPaid: 0,
    totalAfterGst: 0,
    totalGstAmount: 0,
    totalCommission: 0,
    totalCredited: 0,
    currencyCode,
    gstRatePercent: roundMoney(config.wallet.gstRate * 100),
    _operatorIds: new Set(),
  };
}

export function foldTopupSummary(summary, mappedRow) {
  summary.totalRecords += 1;
  summary._operatorIds.add(mappedRow.operatorId);
  summary.totalAmountPaid = roundMoney(summary.totalAmountPaid + mappedRow.amountPaid);
  summary.totalAfterGst = roundMoney(summary.totalAfterGst + mappedRow.afterGst);
  summary.totalGstAmount = roundMoney(summary.totalGstAmount + mappedRow.gstAmount);
  summary.totalCommission = roundMoney(summary.totalCommission + mappedRow.commission);
  summary.totalCredited = roundMoney(summary.totalCredited + mappedRow.credited);
  if (mappedRow.currencyCode) {
    summary.currencyCode = mappedRow.currencyCode;
  }
}

export function finalizeTopupSummary(summary) {
  const uniqueOperators = summary._operatorIds?.size ?? 0;
  const { _operatorIds, ...rest } = summary;
  return { ...rest, uniqueOperators };
}

/**
 * Scan all matching top-ups in batches (memory-safe). Optional callback receives mapped rows per batch.
 */
export async function forEachDealerTopupBatch(filters, fn, { batchSize = REPORT_SCAN_BATCH_SIZE } = {}) {
  const { filters: baseFilters, params: baseParams } = buildDealerTopupBaseFilters(filters);
  const where = `WHERE ${baseFilters.join(' AND ')}`;

  let cursorTime = null;
  let cursorId = null;

  while (true) {
    const params = [...baseParams];
    let cursorClause = '';
    if (cursorTime != null && cursorId != null) {
      cursorClause = `AND (
        COALESCE(wt.completed_at, wt.created_at) < ?
        OR (
          COALESCE(wt.completed_at, wt.created_at) = ?
          AND wt.id < ?
        )
      )`;
      params.push(cursorTime, cursorTime, cursorId);
    }

    const rows = await query(
      `${TOPUP_SELECT}
       ${TOPUP_FROM}
       ${where}
       ${cursorClause}
       ${TOPUP_ORDER}
       LIMIT ${batchSize}`,
      params
    );

    if (!rows.length) break;

    const mapped = rows.map(mapDealerTopupRow);
    await fn(mapped, rows);

    const last = rows[rows.length - 1];
    cursorTime = last.completed_at || last.created_at;
    cursorId = last.id;

    if (rows.length < batchSize) break;
  }
}

export async function computeDealerTopupSummary(filters) {
  const summary = createEmptyTopupSummary();
  await forEachDealerTopupBatch(filters, (mapped) => {
    for (const row of mapped) {
      foldTopupSummary(summary, row);
    }
  });
  return finalizeTopupSummary(summary);
}

export async function getDealerTopupReportPaginated(
  filters,
  { page = 1, limit = 50, search = '', includeSummary = true } = {}
) {
  const { filters: baseFilters, params: baseParams } = buildDealerTopupBaseFilters(filters);
  const { clause: searchClause, params: searchParams } = buildDealerTopupSearchFilter(search);
  const where = `WHERE ${baseFilters.join(' AND ')} ${searchClause}`;
  const listParams = [...baseParams, ...searchParams];

  const [countRow] = await query(
    `SELECT COUNT(*) AS total
     ${TOPUP_FROM}
     ${where}`,
    listParams
  );
  const total = Number(countRow.total) || 0;

  const { page: pageNum, limit: limitNum, clause: pageClause } = paginationSql(page, limit, 100);

  const rows = await query(
    `${TOPUP_SELECT}
     ${TOPUP_FROM}
     ${where}
     ${TOPUP_ORDER}
     ${pageClause}`,
    listParams
  );

  const mapped = rows.map(mapDealerTopupRow);
  let summary = null;
  if (includeSummary) {
    summary = await computeDealerTopupSummary(filters);
  }

  return {
    reportType: 'dealer_topup',
    generatedAt: new Date().toISOString(),
    filters: {
      operatorId: filters.operatorId || null,
      startDate: filters.startDate || null,
      endDate: filters.endDate || null,
      search: search?.trim() || null,
    },
    summary,
    rows: mapped,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum) || 1),
    },
  };
}

/** @deprecated Use getDealerTopupReportPaginated — kept for internal callers migrating to batch APIs */
export async function generateDealerTopupReport(filters) {
  return getDealerTopupReportPaginated(filters, {
    page: filters.page || 1,
    limit: filters.limit || 50,
    search: filters.search || '',
    includeSummary: filters.includeSummary !== false,
  });
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADERS = [
  'Time',
  'Reference',
  'Operator',
  'Operator Email',
  'Amount Paid',
  'GST Amount',
  'After GST',
  'Commission',
  'Credited to Wallet',
  'GST Rate %',
  'Source',
  'Processed By',
  'Payment Reference',
];

function mappedRowToCsvLine(row) {
  return [
    row.time,
    row.reference,
    row.operator,
    row.operatorEmail,
    row.amountPaid,
    row.gstAmount,
    row.afterGst,
    row.commission,
    row.credited,
    row.gstRatePercent,
    row.source,
    row.processedBy,
    row.paymentRef,
  ]
    .map(csvEscape)
    .join(',');
}

export function dealerTopupReportToCsv(report) {
  const lines = [
    'Medianet Voucher — Operator Top-up Report',
    `Generated,${report.generatedAt}`,
    `Period,${report.filters.startDate || 'all'} to ${report.filters.endDate || 'all'}`,
    '',
    'Summary',
    `Total Records,${report.summary.totalRecords}`,
    `Unique Operators,${report.summary.uniqueOperators}`,
    `Total Amount Paid,${report.summary.totalAmountPaid}`,
    `Total After GST,${report.summary.totalAfterGst}`,
    `Total GST,${report.summary.totalGstAmount}`,
    `Total Commission,${report.summary.totalCommission}`,
    `Total Credited,${report.summary.totalCredited}`,
    `Currency,${report.summary.currencyCode}`,
    '',
    CSV_HEADERS.join(','),
  ];

  for (const row of report.rows) {
    lines.push(mappedRowToCsvLine(row));
  }

  return `\ufeff${lines.join('\n')}`;
}

export async function streamDealerTopupReportCsv(res, filters) {
  const summary = await computeDealerTopupSummary(filters);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="operator-topup-report.csv"');
  res.write('\ufeff');

  const headerLines = [
    'Medianet Voucher — Operator Top-up Report',
    `Generated,${new Date().toISOString()}`,
    `Period,${filters.startDate || 'all'} to ${filters.endDate || 'all'}`,
    '',
    'Summary',
    `Total Records,${summary.totalRecords}`,
    `Unique Operators,${summary.uniqueOperators}`,
    `Total Amount Paid,${summary.totalAmountPaid}`,
    `Total After GST,${summary.totalAfterGst}`,
    `Total GST,${summary.totalGstAmount}`,
    `Total Commission,${summary.totalCommission}`,
    `Total Credited,${summary.totalCredited}`,
    `Currency,${summary.currencyCode}`,
    '',
    CSV_HEADERS.join(','),
  ];
  res.write(`${headerLines.join('\n')}\n`);

  await forEachDealerTopupBatch(filters, (mapped) => {
    for (const row of mapped) {
      res.write(`${mappedRowToCsvLine(row)}\n`);
    }
  });

  res.end();
}
