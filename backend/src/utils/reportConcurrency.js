import {
  REPORT_MAX_CONCURRENT,
  REPORT_MAX_QUEUE_SIZE,
  REPORT_MAX_JOBS_PER_USER,
} from '../constants/reportLimits.js';
import { AppError } from './errors.js';

function createPool() {
  return { active: 0, queue: [] };
}

// Staff and operators draw from separate pools so one tenant cannot starve admin reporting.
const pools = { staff: createPool(), operator: createPool() };
const jobsByOwner = new Map();

function ownerOf(req) {
  const user = req?.user;
  if (!user) return { poolName: 'staff', ownerKey: 'anonymous' };
  const poolName = user.role === 'operator' ? 'operator' : 'staff';
  return { poolName, ownerKey: `${poolName}:${user.id}` };
}

function drain(pool) {
  while (pool.active < REPORT_MAX_CONCURRENT && pool.queue.length > 0) {
    const next = pool.queue.shift();
    next();
  }
}

/**
 * Limits concurrent heavy report work so large exports/scans do not exhaust the DB pool.
 * Each user may hold at most REPORT_MAX_JOBS_PER_USER running+queued jobs; queued jobs are
 * dropped if the client disconnects before they start.
 */
export function runWithReportSlot(req, task) {
  const { poolName, ownerKey } = ownerOf(req);
  const pool = pools[poolName];
  const ownerJobs = jobsByOwner.get(ownerKey) || 0;

  if (ownerJobs >= REPORT_MAX_JOBS_PER_USER) {
    return Promise.reject(
      new AppError(
        'You already have a report running. Wait for it to finish before starting another.',
        429,
        'REPORT_IN_PROGRESS'
      )
    );
  }
  if (pool.active >= REPORT_MAX_CONCURRENT && pool.queue.length >= REPORT_MAX_QUEUE_SIZE) {
    return Promise.reject(
      new AppError('Report service is busy. Please try again in a few minutes.', 503, 'REPORT_QUEUE_FULL')
    );
  }

  jobsByOwner.set(ownerKey, ownerJobs + 1);
  const releaseOwner = () => {
    const remaining = (jobsByOwner.get(ownerKey) || 1) - 1;
    if (remaining <= 0) jobsByOwner.delete(ownerKey);
    else jobsByOwner.set(ownerKey, remaining);
  };

  return new Promise((resolve, reject) => {
    let started = false;
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      started = true;
      pool.active += 1;
      try {
        resolve(await task());
      } catch (err) {
        reject(err);
      } finally {
        pool.active -= 1;
        releaseOwner();
        drain(pool);
      }
    };

    // `res` (not `req`) 'close' fires only when the response ends or the socket drops.
    req?.res?.on?.('close', () => {
      if (started || cancelled || req.res.writableFinished) return;
      cancelled = true;
      const index = pool.queue.indexOf(run);
      if (index >= 0) pool.queue.splice(index, 1);
      releaseOwner();
      resolve(undefined);
    });

    if (pool.active < REPORT_MAX_CONCURRENT) {
      run();
    } else {
      pool.queue.push(run);
    }
  });
}
