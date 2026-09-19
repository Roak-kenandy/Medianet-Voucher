import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { formatMoney } from '../../utils/money';

export default function WorkflowSummary({
  walletBalance,
  currencyCode = 'MVR',
  selectedPackages = [],
  unitCost = 0,
  chargeAmount,
  trialFreeCount = 0,
  canAfford = true,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  actionDisabled = false,
  actionLoading = false,
  actionType = 'button',
  showAction = true,
  footnote,
  showChargeBreakdown = true,
}) {
  const resolvedCharge = chargeAmount ?? unitCost;
  const balanceAfter =
    walletBalance != null && resolvedCharge > 0
      ? walletBalance - resolvedCharge
      : walletBalance;
  const isTrialFree = trialFreeCount > 0 && resolvedCharge === 0 && unitCost > 0;
  const showBalanceChange = walletBalance != null && unitCost > 0;

  return (
    <div className="workflow-summary">
      <div className="workflow-summary-top">
        <div className="workflow-summary-top-label">Wallet balance</div>
        <div className="workflow-summary-top-value">
          {walletBalance != null ? formatMoney(walletBalance, currencyCode) : '—'}
        </div>
        {showBalanceChange && (
          <div className="workflow-summary-top-meta">
            After this action:{' '}
            {isTrialFree
              ? `${formatMoney(walletBalance, currencyCode)} (unchanged)`
              : formatMoney(balanceAfter, currencyCode)}
          </div>
        )}
      </div>

      <div className="workflow-summary-body">
        {showChargeBreakdown && (
          <>
            <div className="workflow-summary-section-title">Order summary</div>

            {selectedPackages.length > 0 ? (
              <div className="summary-packages">
                {selectedPackages.map((pkg) => (
                  <div key={pkg.id} className="summary-package-item">
                    <span className="summary-package-item-name">{pkg.name}</span>
                    <span className="summary-package-item-price">
                      {isTrialFree ? (
                        <>
                          <span style={{ textDecoration: 'line-through', opacity: 0.55, marginRight: 8 }}>
                            {formatMoney(pkg.priceAmount, pkg.currencyCode || currencyCode)}
                          </span>
                          Free
                        </>
                      ) : (
                        formatMoney(pkg.priceAmount, pkg.currencyCode || currencyCode)
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                Select a package to see pricing
              </p>
            )}

            {isTrialFree && (
              <div className="summary-line" style={{ marginBottom: 12 }}>
                <span className="summary-line-label">Free trial</span>
                <span className="summary-line-value success">
                  {trialFreeCount} account{trialFreeCount === 1 ? '' : 's'} at no charge
                </span>
              </div>
            )}

            <div className="summary-total-row">
              <span className="summary-total-label">Total charge</span>
              <span className="summary-total-value">
                {isTrialFree ? (
                  <>
                    <span style={{ textDecoration: 'line-through', opacity: 0.55, marginRight: 8, fontWeight: 500 }}>
                      {formatMoney(unitCost, currencyCode)}
                    </span>
                    Free
                  </>
                ) : (
                  formatMoney(resolvedCharge, currencyCode)
                )}
              </span>
            </div>

            {showBalanceChange && (
              <div className="summary-line" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                <span className="summary-line-label">Balance after</span>
                <span className={`summary-line-value${!canAfford && !isTrialFree ? ' danger' : ' success'}`}>
                  {isTrialFree
                    ? `${formatMoney(walletBalance, currencyCode)} (unchanged)`
                    : formatMoney(balanceAfter, currencyCode)}
                </span>
              </div>
            )}
          </>
        )}

        {!canAfford && resolvedCharge > 0 && (
          <div className="workflow-summary-alert danger">
            Insufficient balance. You need {formatMoney(resolvedCharge, currencyCode)} but have{' '}
            {formatMoney(walletBalance, currencyCode)}.{' '}
            <Link to="/operator/wallet" style={{ fontWeight: 600 }}>Top up wallet</Link>
          </div>
        )}

        {showAction && actionLabel && onAction && (
          <div className="workflow-summary-actions">
            <button
              type={actionType}
              className="btn btn-primary btn-lg"
              onClick={onAction}
              disabled={actionDisabled || actionLoading}
            >
              {ActionIcon ? <ActionIcon size={18} /> : null}
              {actionLoading ? 'Processing...' : actionLabel}
            </button>
          </div>
        )}

        {footnote && <p className="workflow-summary-footnote">{footnote}</p>}
      </div>
    </div>
  );
}

export function WorkflowHeaderWallet({ balance, currencyCode = 'MVR' }) {
  if (balance == null) return null;

  return (
    <div className="workflow-header-wallet">
      <div className="workflow-header-wallet-icon">
        <Wallet size={20} />
      </div>
      <div>
        <div className="workflow-header-wallet-label">Available balance</div>
        <div className="workflow-header-wallet-value">{formatMoney(balance, currencyCode)}</div>
      </div>
    </div>
  );
}

export function WorkflowStep({ step, title, description, children }) {
  return (
    <section className="workflow-step">
      <div className="workflow-step-header">
        <span className="workflow-step-num">{step}</span>
        <div>
          <h3 className="workflow-step-title">{title}</h3>
          {description && <p className="workflow-step-desc">{description}</p>}
        </div>
      </div>
      <div className="workflow-step-body">{children}</div>
    </section>
  );
}

export function formatResultCharge(amount, currencyCode) {
  if (!amount || amount === 0) return 'Free (trial)';
  return formatMoney(amount, currencyCode);
}
