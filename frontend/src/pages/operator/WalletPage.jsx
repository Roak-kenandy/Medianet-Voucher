import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, Plus, Receipt } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import WalletTopupBreakdown from '../../components/operator/WalletTopupBreakdown';
import WalletPaymentStatusCard from '../../components/operator/WalletPaymentStatusCard';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatMoney } from '../../utils/money';
import TrialBanner from '../../components/operator/TrialBanner';
import { useAuth } from '../../context/AuthContext';
import { openBmlPayment } from '../../utils/openPayment';
import '../admin/admin-shared.css';
import './operator-workflow.css';

function commissionHint(wallet) {
  if (!wallet || wallet.walletCommissionType !== 'multiplier') return null;
  const multiplier = Number(wallet.walletCommissionValue) || 1;
  if (multiplier <= 1) return null;
  const bonusPercent = Math.round((multiplier - 1) * 10000) / 100;
  return `Payment total is multiplied by ${multiplier.toFixed(2)} (+${bonusPercent}% bonus) before GST is calculated.`;
}

export default function WalletPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentFlow, setPaymentFlow] = useState(null);

  const loadWallet = () => operatorApi.getWallet().then(setWallet);

  useEffect(() => {
    loadWallet();
  }, []);

  useEffect(() => {
    const value = Number(amount);
    if (!value || value <= 0) {
      setPreview(null);
      return;
    }

    const timer = setTimeout(() => {
      operatorApi.previewWalletTopup(value).then(setPreview).catch(() => setPreview(null));
    }, 300);

    return () => clearTimeout(timer);
  }, [amount]);

  const goToPaymentStatus = (reference) => {
    navigate(
      `/operator/wallet/payment/return?reference=${encodeURIComponent(reference)}`
    );
  };

  const handleTopup = async (e) => {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) {
      toast.error('Enter a valid top-up amount');
      return;
    }

    setSubmitting(true);
    setPaymentFlow({ phase: 'initiating', reference: null, amount: value });

    try {
      const result = await operatorApi.initiateWalletTopup(value);

      if (result.paymentUrl) {
        const paymentLink = result.shortPaymentUrl || result.paymentUrl;
        sessionStorage.setItem('pendingTopupReference', result.reference);

        setPaymentFlow({
          phase: 'awaiting',
          reference: result.reference,
          amount: value,
        });

        const opened = openBmlPayment(paymentLink);
        if (!opened) {
          window.location.assign(paymentLink);
          return;
        }

        setAmount('');
        setPreview(null);
        return;
      }

      setPaymentFlow(null);
      toast.success(result.message || 'Wallet topped up successfully');
      setAmount('');
      setPreview(null);
      await loadWallet();
    } catch (err) {
      setPaymentFlow(null);
      toast.error(err.message || 'Top-up failed');
    } finally {
      setSubmitting(false);
    }
  };

  const currencyCode = wallet?.currencyCode || 'MVR';
  const canSelfTopup = wallet?.canSelfTopup !== false;
  const payAmount = Number(amount) || 0;
  const canSubmit = canSelfTopup && payAmount > 0 && preview && !submitting && !paymentFlow;

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="workflow-page-header">
        <div>
          <h1 className="page-title">Wallet</h1>
          <p className="page-subtitle">
            Top up your wallet to create accounts and process customer top-ups.
          </p>
        </div>
        <div className="workflow-header-wallet">
          <div className="workflow-header-wallet-icon">
            <Wallet size={20} />
          </div>
          <div>
            <div className="workflow-header-wallet-label">Available balance</div>
            <div className="workflow-header-wallet-value">
              {wallet ? formatMoney(wallet.balance, currencyCode) : '—'}
            </div>
          </div>
        </div>
      </div>

      <TrialBanner
        trialActive={wallet?.trialActive ?? user?.trialActive}
        trialAccountsRemaining={wallet?.trialAccountsRemaining ?? user?.trialAccountsRemaining}
        trialAccountLimit={wallet?.trialAccountLimit ?? user?.trialAccountLimit}
        trialAccountsUsed={wallet?.trialAccountsUsed ?? user?.trialAccountsUsed}
      />

      {paymentFlow && (
        <section className="workflow-step wallet-payment-return">
          <WalletPaymentStatusCard
            phase={paymentFlow.phase}
            reference={paymentFlow.reference}
            amount={paymentFlow.amount}
            currencyCode={currencyCode}
            onCheckStatus={
              paymentFlow.reference
                ? () => goToPaymentStatus(paymentFlow.reference)
                : undefined
            }
          />
          {paymentFlow.phase === 'awaiting' && (
            <div className="workflow-footer-links wallet-payment-return-links">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPaymentFlow(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      )}

      {!paymentFlow && (
        <div className="wallet-page-layout">
          <div className="wallet-page-main">
            {!canSelfTopup && (
              <div className="alert alert-info" style={{ marginBottom: 20 }}>
                Wallet top-up is managed by Medianet for your account. Contact support@medianet.mv to add funds.
                You can still use your current balance to create accounts and serve customers.
              </div>
            )}

            {canSelfTopup ? (
              <section className="workflow-step">
                <div className="workflow-step-header">
                  <span className="workflow-step-num">1</span>
                  <div>
                    <h3 className="workflow-step-title">Enter payment amount</h3>
                    <p className="workflow-step-desc">
                      You will be redirected to Bank of Maldives to pay securely.
                    </p>
                  </div>
                </div>
                <div className="workflow-step-body">
                  <form onSubmit={handleTopup}>
                    <div className="form-group">
                      <label htmlFor="topupAmount" className="form-label">
                        Amount to pay ({currencyCode})
                      </label>
                      <input
                        id="topupAmount"
                        type="number"
                        min={wallet?.minTopupAmount ?? 1}
                        max={wallet?.maxTopupAmount || 1000000}
                        step="any"
                        className="form-input wallet-amount-input"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="e.g. 3000"
                      />
                      <p className="form-hint">
                        Minimum {formatMoney(wallet?.minTopupAmount ?? 1, currencyCode)}
                        {commissionHint(wallet) ? ` · ${commissionHint(wallet)}` : ''}
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary btn-lg wallet-submit-btn"
                      disabled={!canSubmit}
                    >
                      <Plus size={18} />
                      {submitting
                        ? 'Initiating payment…'
                        : preview
                          ? `Pay ${formatMoney(preview.amountPaid ?? preview.amount, currencyCode)} · Credit ${formatMoney(preview.net, currencyCode)}`
                          : 'Top Up Wallet'}
                    </button>
                  </form>
                </div>
              </section>
            ) : (
              <section className="workflow-step">
                <div className="workflow-step-header">
                  <span className="workflow-step-num">—</span>
                  <div>
                    <h3 className="workflow-step-title">Wallet balance</h3>
                    <p className="workflow-step-desc">
                      View your balance and transaction history below. Self-service top-up is not enabled for your account.
                    </p>
                  </div>
                </div>
              </section>
            )}

            <div className="workflow-footer-links">
              <Link to="/operator/transactions"><Receipt size={14} /> Transaction reports</Link>
              <Link to="/operator/create">Create account</Link>
              <Link to="/operator/customers?mode=topup">Topup</Link>
              <Link to="/operator/customers?mode=subscribe">Subscribe</Link>
            </div>
          </div>

          {canSelfTopup && (
            <aside className="wallet-page-sidebar">
              <WalletTopupBreakdown
                preview={preview}
                currencyCode={currencyCode}
                currentBalance={wallet?.balance ?? null}
              />

              {!preview && (
                <div className="wallet-topup-placeholder">
                  <Receipt size={28} strokeWidth={1.5} />
                  <p>Enter an amount to see a full payment breakdown before you confirm.</p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </Layout>
  );
}
