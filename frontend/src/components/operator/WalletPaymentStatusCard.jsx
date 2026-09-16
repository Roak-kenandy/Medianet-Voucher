import { Link } from 'react-router-dom';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
} from 'lucide-react';
import { formatMoney } from '../../utils/money';

const STATES = {
  initiating: {
    icon: Loader2,
    iconClass: 'spin-icon',
    tone: 'processing',
    title: 'Charge initiated',
    lines: [
      'Your payment is being submitted. This usually takes a few seconds.',
      'Please do not refresh or close this page.',
      'We are opening Bank of Maldives for you to enter card details securely.',
    ],
  },
  awaiting: {
    icon: ExternalLink,
    tone: 'processing',
    title: 'Complete payment at the bank',
    lines: [
      'A secure Bank of Maldives tab is open — enter your card details there.',
      'Do not refresh or close the bank page while paying.',
      'When finished, return here and tap “Check payment status” below.',
    ],
  },
  confirming: {
    icon: Loader2,
    iconClass: 'spin-icon',
    tone: 'processing',
    title: 'Confirming payment',
    lines: [
      'We are verifying your payment with Bank of Maldives.',
      'Please do not refresh or close this page.',
      'Do not switch tabs or hit the back button until confirmation finishes.',
    ],
  },
  completed: {
    icon: CheckCircle2,
    tone: 'success',
    title: 'Payment successful',
    lines: [],
  },
  cancelled: {
    icon: Ban,
    tone: 'warning',
    title: 'Payment cancelled',
    lines: [
      'You cancelled the payment or closed the bank page before completing it.',
      'No money was taken from your account. You can start a new top-up when ready.',
    ],
  },
  failed: {
    icon: XCircle,
    tone: 'error',
    title: 'Payment unsuccessful',
    lines: [
      'The bank could not complete this payment.',
      'No wallet credit was applied. Please try again or use a different card or browser.',
    ],
  },
  pending: {
    icon: Loader2,
    iconClass: 'spin-icon',
    tone: 'processing',
    title: 'Payment still processing',
    lines: [
      'The bank is still processing your payment. This can take a few minutes.',
      'Please wait here — do not start another top-up for the same amount yet.',
      'If nothing changes after 10 minutes, contact support with your reference number.',
    ],
  },
  missing: {
    icon: AlertTriangle,
    tone: 'error',
    title: 'Payment reference missing',
    lines: ['We could not find which top-up to verify. Return to the wallet and try again.'],
  },
  error: {
    icon: ShieldAlert,
    tone: 'error',
    title: 'Could not verify payment',
    lines: [
      'We could not reach the bank to confirm this payment.',
      'If you completed payment, wait a minute and check status again from the wallet page.',
    ],
  },
};

export default function WalletPaymentStatusCard({
  phase,
  reference,
  amount,
  credited,
  balance,
  currencyCode = 'MVR',
  onCheckStatus,
  children,
}) {
  const config = STATES[phase] || STATES.confirming;
  const Icon = config.icon;

  return (
    <div className={`wallet-payment-status-card wallet-payment-status-${config.tone}`}>
      <div className="wallet-payment-status-icon">
        <Icon size={44} className={config.iconClass} />
      </div>

      <h2 className="wallet-payment-status-title">{config.title}</h2>

      {reference && (
        <p className="wallet-payment-status-ref">Reference {reference}</p>
      )}

      {phase === 'completed' && (
        <div className="wallet-payment-status-summary">
          {amount != null && Number(amount) > 0 && (
            <p>You paid {formatMoney(amount, currencyCode)}.</p>
          )}
          {credited != null && (
            <p className="wallet-payment-status-highlight">
              {formatMoney(credited, currencyCode)} credited to your wallet.
            </p>
          )}
          {balance != null && (
            <p>New balance: {formatMoney(balance, currencyCode)}</p>
          )}
        </div>
      )}

      {config.lines.length > 0 && (
        <ul className="wallet-payment-status-lines">
          {config.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {phase === 'awaiting' && onCheckStatus && (
        <div className="wallet-payment-status-actions">
          <button type="button" className="btn btn-primary" onClick={onCheckStatus}>
            Check payment status
          </button>
        </div>
      )}

      {(phase === 'cancelled' || phase === 'failed' || phase === 'error') && (
        <div className="wallet-payment-status-actions">
          <Link to="/operator/wallet" className="btn btn-primary">
            Try again
          </Link>
        </div>
      )}

      {phase === 'completed' && (
        <div className="wallet-payment-status-actions">
          <Link to="/operator/wallet" className="btn btn-primary">
            Back to wallet
          </Link>
          <Link to="/operator/transactions" className="btn btn-secondary">
            View transactions
          </Link>
        </div>
      )}

      {children}
    </div>
  );
}
