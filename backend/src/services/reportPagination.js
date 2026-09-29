import { query } from '../db/pool.js';
import { REPORT_SCAN_BATCH_SIZE } from '../constants/reportLimits.js';
import { paginationSql } from '../utils/pagination.js';
import { csvEscape } from '../utils/csv.js';
import { runStreamingExport, writeChunk } from '../utils/streamWrite.js';

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

  await runStreamingExport(res, async () => {
    await writeChunk(res, '\ufeff');
    if (titleLines.length) {
      await writeChunk(res, `${titleLines.join('\n')}\n`);
    }
    await writeChunk(res, `${headers.map(csvEscape).join(',')}\n`);

    const [countRow] = await query(countSql, countParams);
    const total = Number(countRow?.total ?? countRow?.cnt ?? 0) || 0;

    let offset = 0;
    while (offset < total) {
      const { clause } = paginationSql(Math.floor(offset / batchSize) + 1, batchSize, batchSize);
      const rows = await query(`${batchSql} ${clause}`, batchParams);
      if (!rows.length) break;
      const chunk = rows.map((row) => `${rowToCells(row).map(csvEscape).join(',')}\n`).join('');
      await writeChunk(res, chunk);
      offset += rows.length;
      if (rows.length < batchSize) break;
    }

    res.end();
  });
}
