import { query } from '../db/pool.js';

export async function generateReport({ operatorId, packageType, startDate, endDate, reportType }) {
  if (reportType === 'accounts_by_period') {
    return accountsByPeriodReport({ operatorId, packageType, startDate, endDate });
  }
  if (reportType === 'package_breakdown') {
    return packageBreakdownReport({ startDate, endDate });
  }
  return clientSummaryReport({ operatorId, packageType, startDate, endDate });
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
