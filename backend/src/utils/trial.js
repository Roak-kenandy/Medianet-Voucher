export function getTrialQuotaInfo(trialAccountLimit, trialAccountsUsed) {
  const limit = Math.max(0, Number(trialAccountLimit) || 0);
  const used = Math.max(0, Number(trialAccountsUsed) || 0);
  const remaining = Math.max(0, limit - used);

  return {
    trialAccountLimit: limit,
    trialAccountsUsed: used,
    trialAccountsRemaining: remaining,
    trialActive: limit > 0 && remaining > 0,
  };
}

export function formatTrialForResponse(trialAccountLimit, trialAccountsUsed) {
  return getTrialQuotaInfo(trialAccountLimit, trialAccountsUsed);
}

export function countPaidAccountCreations(accountCount, trialAccountsRemaining) {
  const remaining = Math.max(0, Number(trialAccountsRemaining) || 0);
  return Math.max(0, accountCount - remaining);
}
