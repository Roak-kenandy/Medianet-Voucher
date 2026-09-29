import { config } from '../config/index.js';
import { AppError } from './errors.js';

let globalActive = 0;
const activeByOperator = new Map();

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
