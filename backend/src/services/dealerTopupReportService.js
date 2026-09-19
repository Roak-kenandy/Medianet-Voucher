import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { calculateGstFromTotal } from './walletService.js';

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

function resolveTopupFinancials(row, metadata) {
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

function resolveProcessedBy(row, operatorEmail, adminEmail) {
  if (row.created_by_type === 'admin' && adminEmail) {
    return adminEmail;
  }
  if (row.created_by_type === 'operator' && operatorEmail) {
    return operatorEmail;
  }
  return operatorEmail || adminEmail || 'system';
}

export async function generateDealerTopupReport({ operatorId, startDate, endDate } = {}) {
  const filters = [`wt.type = 'topup'`, `wt.status = 'completed'`];
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

  const where = `WHERE ${filters.join(' AND ')}`;

  const rows = await query(
    `SELECT wt.id, wt.reference, wt.amount, wt.commission_amount, wt.net_amount,
            wt.payment_ref, wt.description, wt.metadata, wt.created_by_type, wt.created_by_id,
            wt.created_at, wt.completed_at, wt.currency_code,
            o.id AS operator_id, o.client_name, o.email AS operator_email,
            a.email AS admin_email, a.name AS admin_name
     FROM wallet_transactions wt
     INNER JOIN operators o ON o.id = wt.operator_id
     LEFT JOIN admins a ON wt.created_by_type = 'admin' AND wt.created_by_id = a.id
     ${where}
     ORDER BY COALESCE(wt.completed_at, wt.created_at) DESC`,
    params
  );

  const mapped = rows.map((row) => {
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
      processedBy: resolveProcessedBy(row, row.operator_email, row.admin_email),
      paymentRef: row.payment_ref || '',
      operatorId: row.operator_id,
      currencyCode: row.currency_code || config.wallet.currencyCode,
      transactionId: row.id,
      completedAt: eventTime,
    };
  });

  const summary = {
    totalRecords: mapped.length,
    uniqueOperators: new Set(mapped.map((row) => row.operatorId)).size,
    totalAmountPaid: roundMoney(mapped.reduce((sum, row) => sum + row.amountPaid, 0)),
    totalAfterGst: roundMoney(mapped.reduce((sum, row) => sum + row.afterGst, 0)),
    totalGstAmount: roundMoney(mapped.reduce((sum, row) => sum + row.gstAmount, 0)),
    totalCommission: roundMoney(mapped.reduce((sum, row) => sum + row.commission, 0)),
    totalCredited: roundMoney(mapped.reduce((sum, row) => sum + row.credited, 0)),
    currencyCode: mapped[0]?.currencyCode || config.wallet.currencyCode,
    gstRatePercent: roundMoney(config.wallet.gstRate * 100),
  };

  return {
    reportType: 'dealer_topup',
    generatedAt: new Date().toISOString(),
    filters: { operatorId: operatorId || null, startDate: startDate || null, endDate: endDate || null },
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

export function dealerTopupReportToCsv(report) {
  const headers = [
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
    'Processed By',
    'Payment Reference',
  ];

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
    headers.join(','),
  ];

  for (const row of report.rows) {
    lines.push(
      [
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
        row.processedBy,
        row.paymentRef,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\ufeff${lines.join('\n')}`;
}
