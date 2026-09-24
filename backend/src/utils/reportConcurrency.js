import { REPORT_MAX_CONCURRENT, REPORT_MAX_QUEUE_SIZE } from '../constants/reportLimits.js';
import { AppError } from './errors.js';

let active = 0;
const waitQueue = [];

function drainQueue() {
  while (active < REPORT_MAX_CONCURRENT && waitQueue.length > 0) {
    const next = waitQueue.shift();
    next();
  }
}

/**
 * Limits concurrent heavy report work so large exports/scans do not exhaust the DB pool
 * or block normal API traffic for long stretches.
 */
export function runWithReportSlot(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active += 1;
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        active -= 1;
        drainQueue();
      }
    };

    if (active < REPORT_MAX_CONCURRENT) {
      run();
    } else if (waitQueue.length >= REPORT_MAX_QUEUE_SIZE) {
      reject(
        new AppError(
          'Report service is busy. Please try again in a few minutes.',
          503,
          'REPORT_QUEUE_FULL'
        )
      );
    } else {
      waitQueue.push(run);
    }
  });
}
