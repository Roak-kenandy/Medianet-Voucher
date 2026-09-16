import { formatMoney } from '../../utils/money';

function formatPercent(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '—';
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2)}%`;
}

export default function WalletTopupBreakdown({
  preview,
  currencyCode = 'MVR',
  currentBalance = null,
}) {
  if (!preview) return null;

  const balanceAfter =
    currentBalance != null ? currentBalance + Number(preview.net || 0) : null;

  return (
    <div className="wallet-topup-receipt" aria-live="polite">
      <div className="wallet-topup-receipt-header">
        <h4 className="wallet-topup-receipt-title">Payment breakdown</h4>
      </div>

      <div className="wallet-topup-receipt-body">
        <div className="wallet-topup-line">
          <span className="wallet-topup-line-label">Amount you pay</span>
          <span className="wallet-topup-line-value">{formatMoney(preview.amountPaid ?? preview.amount, currencyCode)}</span>
        </div>

        <div className="wallet-topup-line wallet-topup-line-deduct">
          <span className="wallet-topup-line-label">
            GST ({formatPercent(preview.gstRatePercent ?? preview.gstRate * 100)})
          </span>
          <span className="wallet-topup-line-value">
            − {formatMoney(preview.gstAmount, currencyCode)}
          </span>
        </div>

        <div className="wallet-topup-line wallet-topup-line-subtotal">
          <span className="wallet-topup-line-label">Wallet credit (after GST)</span>
          <span className="wallet-topup-line-value">{formatMoney(preview.afterGst, currencyCode)}</span>
        </div>

        {preview.commission > 0 && (
          <div className="wallet-topup-line wallet-topup-line-bonus">
            <span className="wallet-topup-line-label">Operator bonus</span>
            <span className="wallet-topup-line-value">
              + {formatMoney(preview.commission, currencyCode)}
            </span>
          </div>
        )}

        <div className="wallet-topup-total">
          <span className="wallet-topup-total-label">Added to wallet balance</span>
          <span className="wallet-topup-total-value">{formatMoney(preview.net, currencyCode)}</span>
        </div>

        {currentBalance != null && (
          <div className="wallet-topup-balance-change">
            <div className="wallet-topup-line">
              <span className="wallet-topup-line-label">Current balance</span>
              <span className="wallet-topup-line-value">{formatMoney(currentBalance, currencyCode)}</span>
            </div>
            <div className="wallet-topup-line">
              <span className="wallet-topup-line-label">Balance after top-up</span>
              <span className="wallet-topup-line-value wallet-topup-line-value-highlight">
                {formatMoney(balanceAfter, currencyCode)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
