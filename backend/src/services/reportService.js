import { query } from '../db/pool.js';
import {
  getDealerTopupReportPaginated,
  dealerTopupReportToCsv,
  streamDealerTopupReportCsv,
} from './dealerTopupReportService.js';
import { generateSalesReport, salesReportToCsv, streamSalesReportCsv } from './salesReportService.js';
import { REPORT_DEFAULT_PAGE_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';
import { streamCsvFromOffsetBatches } from './reportPagination.js';

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

function buildCustomerSummaryFilters({ operatorId, packageType, startDate, endDate }, search) {
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
    filters.push('va.operator_id = ?');
    params.push(operatorId);
  }
  if (packageType) {
    filters.push(`(
      EXISTS (
        SELECT 1 FROM voucher_account_packages vap_f
        JOIN packages p_f ON p_f.id = vap_f.package_id
        WHERE vap_f.voucher_account_id = va.id AND p_f.name = ?
      )
      OR EXISTS (
        SELECT 1 FROM packages p_f
        WHERE p_f.id = va.package_id AND p_f.name = ?
      )
    )`);
    params.push(packageType, packageType);
  }

  const term = search?.trim();
  if (term) {
    const like = `%${term}%`;
    filters.push(`(
      va.full_name LIKE ?
      OR va.phone_number LIKE ?
      OR o.client_name LIKE ?
      OR o.email LIKE ?
      OR va.external_ref LIKE ?
    )`);
    params.push(like, like, like, like, like);
  }

  return { filters, params, where: `WHERE ${filters.join(' AND ')}` };
}

const CUSTOMER_SUMMARY_SELECT = `SELECT
       va.id AS accountId,
       va.full_name AS customerName,
       va.phone_number AS phoneNumber,
       va.service_tag AS serviceTag,
       va.status,
       va.external_ref AS externalRef,
       va.error_message AS errorMessage,
       va.amount_charged AS amountCharged,
       va.created_at AS activatedAt,
       o.id AS operatorId,
       o.client_name AS operatorName,
       o.email AS operatorEmail,
       GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS packages`;

const CUSTOMER_SUMMARY_FROM = `FROM voucher_accounts va
     JOIN operators o ON o.id = va.operator_id
     LEFT JOIN voucher_account_packages vap ON vap.voucher_account_id = va.id
     LEFT JOIN packages p ON p.id = COALESCE(vap.package_id, va.package_id)`;

const CUSTOMER_SUMMARY_GROUP = `GROUP BY va.id, va.full_name, va.phone_number, va.service_tag, va.status, va.external_ref,
              va.error_message, va.amount_charged, va.created_at, o.id, o.client_name, o.email`;

async function customerSummaryReport(filters, { page, limit, search, includeSummary }) {
  const { params, where } = buildCustomerSummaryFilters(filters, search);

  const [countRow] = await query(
    `SELECT COUNT(DISTINCT va.id) AS total
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
     ${CUSTOMER_SUMMARY_GROUP}
     ORDER BY va.created_at DESC
     ${pageClause}`,
    params
  );

  const mapped = rows.map((row) => ({
    ...row,
    amountCharged: row.amountCharged != null ? Number(row.amountCharged) : null,
    activatedAt: row.activatedAt ? new Date(row.activatedAt).toISOString() : '',
  }));

  let summary = null;
  if (includeSummary) {
    const [summaryRow] = await query(
      `SELECT
         COUNT(DISTINCT va.id) AS totalCustomers,
         SUM(CASE WHEN va.status = 'created' THEN 1 ELSE 0 END) AS createdCount,
         SUM(CASE WHEN va.status IN ('pending', 'processing') THEN 1 ELSE 0 END) AS pendingCount,
         SUM(CASE WHEN va.status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
         COUNT(DISTINCT va.operator_id) AS uniqueOperators
       ${CUSTOMER_SUMMARY_FROM}
       ${buildCustomerSummaryFilters(filters, '').where}`,
      buildCustomerSummaryFilters(filters, '').params
    );
    summary = {
      totalCustomers: Number(summaryRow.totalCustomers) || 0,
      createdCount: Number(summaryRow.createdCount) || 0,
      pendingCount: Number(summaryRow.pendingCount) || 0,
      failedCount: Number(summaryRow.failedCount) || 0,
      uniqueOperators: Number(summaryRow.uniqueOperators) || 0,
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
    headers.join(','),
    ...report.rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h] ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
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
      `SELECT COUNT(DISTINCT va.id) AS totalCustomers
       ${CUSTOMER_SUMMARY_FROM}
       ${where}`,
      params
    );

    const titleLines = [
      'Medianet Voucher — Customer Summary Report',
      `Generated,${new Date().toISOString()}`,
      `Period,${filters.startDate || 'all'} to ${filters.endDate || 'all'}`,
      '',
      `Total Customers,${Number(summaryRow.totalCustomers) || 0}`,
      '',
    ];

    const headers = [
      'accountId',
      'customerName',
      'phoneNumber',
      'serviceTag',
      'status',
      'packages',
      'operatorName',
      'amountCharged',
      'activatedAt',
    ];

    await streamCsvFromOffsetBatches(res, {
      filename: 'report-customer_summary.csv',
      titleLines,
      headers,
      rowToCells: (row) => [
        row.accountId,
        row.customerName,
        row.phoneNumber,
        row.serviceTag,
        row.status,
        row.packages,
        row.operatorName,
        row.amountCharged,
        row.activatedAt ? new Date(row.activatedAt).toISOString() : '',
      ],
      countSql: `SELECT COUNT(DISTINCT va.id) AS total ${CUSTOMER_SUMMARY_FROM} ${where}`,
      countParams: params,
      batchSql: `${CUSTOMER_SUMMARY_SELECT} ${CUSTOMER_SUMMARY_FROM} ${where} ${CUSTOMER_SUMMARY_GROUP} ORDER BY va.created_at DESC`,
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
