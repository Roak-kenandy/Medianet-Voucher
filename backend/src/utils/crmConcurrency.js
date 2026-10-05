import { config } from '../config/index.js';
import { AppError } from './errors.js';

let globalActive = 0;
const activeByOperator = new Map();

let globalReadActive = 0;
const readActiveByOperator = new Map();

/**
 * Caps in-flight CRM customer lookups per operator and process-wide, separately from the
 * paid flows, so read traffic cannot use up the CRM capacity that payments depend on.
 */
export async function withCrmReadSlot(operatorId, task) {
  const key = String(operatorId);
  const operatorActive = readActiveByOperator.get(key) || 0;

  if (operatorActive >= config.crm.maxReadConcurrentPerOperator) {
    throw new AppError(
      'A customer lookup is already in progress. Please wait for it to finish.',
      429,
      'CRM_LOOKUP_IN_PROGRESS'
    );
  }
  if (globalReadActive >= config.crm.maxReadConcurrentGlobal) {
    throw new AppError('Customer lookup is busy. Please try again shortly.', 503, 'CRM_BUSY');
  }

  globalReadActive += 1;
  readActiveByOperator.set(key, operatorActive + 1);
  try {
    return await task();
  } finally {
    globalReadActive -= 1;
    const remaining = (readActiveByOperator.get(key) || 1) - 1;
    if (remaining <= 0) readActiveByOperator.delete(key);
    else readActiveByOperator.set(key, remaining);
  }
}

/**
 * Caps in-flight CRM provisioning per operator and process-wide. Excess requests are
 * rejected immediately (no queue) so slow CRM calls cannot pile up behind one tenant.
 */
export async function withCrmSlot(operatorId, task) {
  const key = String(operatorId);
  const operatorActive = activeByOperator.get(key) || 0;

  if (operatorActive >= config.crm.maxConcurrentPerOperator) {
    throw new AppError(
      'Another activation is still in progress for your account. Please wait for it to finish.',
      429,
      'CRM_OPERATION_IN_PROGRESS'
    );
  }
  if (globalActive >= config.crm.maxConcurrentGlobal) {
    throw new AppError('Activation service is busy. Please try again shortly.', 503, 'CRM_BUSY');
  }

  globalActive += 1;
  activeByOperator.set(key, operatorActive + 1);
  try {
    return await task();
  } finally {
    globalActive -= 1;
    const remaining = (activeByOperator.get(key) || 1) - 1;
    if (remaining <= 0) activeByOperator.delete(key);
    else activeByOperator.set(key, remaining);
  }
}
