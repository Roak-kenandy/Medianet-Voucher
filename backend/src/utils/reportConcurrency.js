import { REPORT_MAX_CONCURRENT } from '../constants/reportLimits.js';

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
    } else {
      waitQueue.push(run);
    }
  });
}
