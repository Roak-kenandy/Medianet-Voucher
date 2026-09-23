import { query } from '../db/pool.js';
import { REPORT_SCAN_BATCH_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Stream CSV rows in batches using LIMIT/OFFSET (safe for moderate export sizes).
 */
export async function streamCsvFromOffsetBatches(
  res,
  {
    filename,
    titleLines = [],
    headers,
    rowToCells,
    countSql,
    countParams,
    batchSql,
    batchParams,
    batchSize = REPORT_SCAN_BATCH_SIZE,
  }
) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('\ufeff');

  if (titleLines.length) {
    res.write(`${titleLines.join('\n')}\n`);
  }
  res.write(`${headers.map(csvEscape).join(',')}\n`);

  const [countRow] = await query(countSql, countParams);
  const total = Number(countRow?.total ?? countRow?.cnt ?? 0) || 0;

  let offset = 0;
  while (offset < total) {
    const { clause } = paginationSql(Math.floor(offset / batchSize) + 1, batchSize, batchSize);
    const rows = await query(`${batchSql} ${clause}`, batchParams);
    if (!rows.length) break;
    for (const row of rows) {
      res.write(`${rowToCells(row).map(csvEscape).join(',')}\n`);
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  res.end();
}
