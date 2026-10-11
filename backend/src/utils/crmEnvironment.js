import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './errors.js';

/*
 * Which CRM a piece of work talks to: `live` (production) or `sandbox` (UAT). It is carried
 * through async calls rather than passed as an argument, so the CRM service picks the right
 * URL and key on every request without each of its methods having to forward it.
 * There is deliberately no default: CRM work outside `runInCrmEnvironment` fails instead of
 * quietly reaching the live CRM.
 */
export const CRM_ENVIRONMENTS = ['live', 'sandbox'];

const storage = new AsyncLocalStorage();

export function normalizeCrmEnvironment(environment) {
  if (!CRM_ENVIRONMENTS.includes(environment)) {
    throw new AppError('Unknown CRM environment', 500, 'INTERNAL_ERROR');
  }
  return environment;
}

export function runInCrmEnvironment(environment, task) {
  return storage.run(normalizeCrmEnvironment(environment), task);
}

export function currentCrmEnvironment() {
  const environment = storage.getStore();
  if (!environment) {
    throw new AppError('CRM environment was not selected for this operation', 500, 'INTERNAL_ERROR');
  }
  return environment;
}
