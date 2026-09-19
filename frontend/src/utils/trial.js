export function computeAccountCreationCharge(unitCost, accountCount, trialAccountsRemaining) {
  const remaining = Math.max(0, Number(trialAccountsRemaining) || 0);
  const count = Math.max(0, Number(accountCount) || 0);
  const cost = Math.max(0, Number(unitCost) || 0);
  const freeCount = Math.min(count, remaining);
  const paidCount = count - freeCount;
  const effectiveCharge = Math.round(cost * paidCount * 100) / 100;

  return {
    freeCount,
    paidCount,
    effectiveCharge,
    usesTrial: freeCount > 0,
  };
}
