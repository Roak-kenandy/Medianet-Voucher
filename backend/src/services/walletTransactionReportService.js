import { query } from '../db/pool.js';
import { resolveWalletTransactionBalances } from './walletService.js';
import { csvEscape } from '../utils/csv.js';
import {
  REPORT_SCAN_BATCH_SIZE,
  REPORT_MAX_WALLET_TX_EXPORT_ROWS,
  REPORT_DEFAULT_PAGE_SIZE,
  REPORT_MAX_PAGE_SIZE,
} from '../constants/reportLimits.js';
import { AppError } from '../utils/errors.js';
import { operatorSpendDebitSql } from '../utils/walletSql.js';
import { runStreamingExport, writeChunk } from '../utils/streamWrite.js';

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
  if (metadata.activity === 'customer_renew') return 'Customer Renewal';
  if (metadata.activity === 'customer_upgrade') return 'Customer Upgrade';
  if (metadata.activity === 'customer_topup') return 'Customer Top-up';
  if (metadata.activity === 'bulk_create') return 'Bulk Create';
  if (metadata.activity === 'admin_adjustment') return 'Adjustment';
  if (metadata.refundOf) return 'Refund';
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Summary via SQL aggregates + one page of rows, so large histories never load into memory. */
export async function generateWalletTransactionReport(
  operatorId,
  { startDate, endDate, type, page = 1, limit = REPORT_DEFAULT_PAGE_SIZE } = {}
) {
  const params = [operatorId];
  const filters = buildDateFilters({ startDate, endDate }, params);

  if (type) {
    filters.push('wt.type = ?');
    params.push(type);
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const spend = operatorSpendDebitSql('wt');
  const activity = `JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity'))`;

  const [agg] = await query(
    `SELECT
       COUNT(*) AS totalTransactions,
       COALESCE(SUM(wt.type = 'topup' AND wt.status = 'completed'), 0) AS totalTopups,
       COALESCE(SUM(${spend}), 0) AS totalDebits,
       COALESCE(SUM(CASE WHEN wt.type = 'topup' AND wt.status = 'completed' THEN wt.net_amount ELSE 0 END), 0) AS totalCredited,
       COALESCE(SUM(CASE WHEN ${spend} THEN wt.net_amount ELSE 0 END), 0) AS totalDebited,
       COALESCE(SUM(CASE WHEN ${spend} AND ${activity} = 'create_account' THEN wt.net_amount ELSE 0 END), 0) AS createAccountCharges,
       COALESCE(SUM(CASE WHEN ${spend} AND ${activity} IN ('customer_crm_topup', 'customer_topup') THEN wt.net_amount ELSE 0 END), 0) AS customerTopupCharges,
       COALESCE(SUM(CASE WHEN wt.type = 'refund' AND wt.status = 'completed' THEN wt.net_amount ELSE 0 END), 0) AS totalRefunded
     FROM wallet_transactions wt
     ${where}`,
    params
  );

  const pageSize = Math.min(REPORT_MAX_PAGE_SIZE, Math.max(1, Number(limit) || REPORT_DEFAULT_PAGE_SIZE));
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * pageSize;

  const rows = await query(
    `SELECT wt.id, wt.type, wt.status, wt.amount, wt.commission_amount, wt.net_amount,
            wt.balance_before, wt.balance_after, wt.currency_code, wt.reference,
            wt.payment_ref, wt.description, wt.metadata, wt.voucher_account_id,
            wt.created_at, wt.completed_at
     FROM wallet_transactions wt
     ${where}
     ORDER BY wt.created_at DESC, wt.id DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  const total = Number(agg?.totalTransactions) || 0;
  const summary = {
    totalTransactions: total,
    totalTopups: Number(agg?.totalTopups) || 0,
    totalDebits: Number(agg?.totalDebits) || 0,
    totalCredited: roundMoney(agg?.totalCredited),
    totalDebited: roundMoney(agg?.totalDebited),
    createAccountCharges: roundMoney(agg?.createAccountCharges),
    customerTopupCharges: roundMoney(agg?.customerTopupCharges),
    totalRefunded: roundMoney(agg?.totalRefunded),
    currencyCode: rows[0]?.currency_code || 'MVR',
  };

  return {
    generatedAt: new Date().toISOString(),
    filters: { startDate: startDate || null, endDate: endDate || null, type: type || null },
    summary,
    rows: rows.map(mapTransactionRow),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
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

  await runStreamingExport(res, async () => {
    await writeChunk(
      res,
      '\ufeff' +
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
          .join(',') +
        '\n'
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
         LIMIT ${REPORT_SCAN_BATCH_SIZE}`,
        batchParams
      );

      if (!rows.length) {
        break;
      }

      const chunk = rows
        .map((row) => {
          const mapped = mapTransactionRow(row);
          return (
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
        })
        .join('');
      await writeChunk(res, chunk);
      exported += rows.length;
      lastId = rows[rows.length - 1].id;
    }

    res.end();
  });
}
