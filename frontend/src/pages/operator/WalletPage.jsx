import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, Plus, Receipt, ExternalLink, RefreshCw } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import WalletTopupBreakdown from '../../components/operator/WalletTopupBreakdown';
import WalletPaymentStatusCard from '../../components/operator/WalletPaymentStatusCard';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatMoney } from '../../utils/money';
import { openBmlPayment } from '../../utils/openPayment';
import '../admin/admin-shared.css';
import './operator-workflow.css';

function commissionHint(wallet, currencyCode) {
  if (!wallet || wallet.walletCommissionType === 'none') return null;
  if (wallet.walletCommissionType === 'fixed') {
    return `Includes a ${formatMoney(wallet.walletCommissionValue, currencyCode)} operator bonus after GST.`;
  }
  return `Includes a ${wallet.walletCommissionValue}% operator bonus on the post-GST amount.`;
}

export default function WalletPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingTopup, setPendingTopup] = useState(null);
  const [paymentFlow, setPaymentFlow] = useState(null);

  const loadWallet = () => operatorApi.getWallet().then(setWallet);

  const loadPendingTopup = useCallback(() => {
    return operatorApi
      .getPendingWalletTopup()
      .then((data) => setPendingTopup(data.pending))
      .catch(() => setPendingTopup(null));
  }, []);

  useEffect(() => {
    loadWallet();
    loadPendingTopup();
  }, [loadPendingTopup]);

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
        await loadPendingTopup();
        return;
      }

      setPaymentFlow(null);
      toast.success(result.message || 'Wallet topped up successfully');
      setAmount('');
      setPreview(null);
      await loadWallet();
      await loadPendingTopup();
    } catch (err) {
      setPaymentFlow(null);
      toast.error(err.message || 'Top-up failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinuePending = () => {
    if (!pendingTopup) return;
    const paymentLink = pendingTopup.shortPaymentUrl || pendingTopup.paymentUrl;
    sessionStorage.setItem('pendingTopupReference', pendingTopup.reference);
    openBmlPayment(paymentLink);
    setPaymentFlow({
      phase: 'awaiting',
      reference: pendingTopup.reference,
      amount: pendingTopup.amount,
    });
  };

  const currencyCode = wallet?.currencyCode || 'MVR';
  const payAmount = Number(amount) || 0;
  const canSubmit = payAmount > 0 && preview && !submitting && !paymentFlow;

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

      {pendingTopup && !paymentFlow && (
        <div className="wallet-pending-banner">
          <div>
            <strong>Pending payment</strong>
            <p>
              {formatMoney(pendingTopup.amount, currencyCode)} · Ref {pendingTopup.reference}
            </p>
          </div>
          <div className="wallet-pending-banner-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleContinuePending}>
              <ExternalLink size={14} /> Open payment
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToPaymentStatus(pendingTopup.reference)}
            >
              <RefreshCw size={14} /> Check status
            </button>
          </div>
        </div>
      )}

      {!paymentFlow && (
        <div className="wallet-page-layout">
          <div className="wallet-page-main">
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
                      step="0.01"
                      className="form-input wallet-amount-input"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 3000"
                    />
                    <p className="form-hint">
                      Minimum {formatMoney(wallet?.minTopupAmount ?? 1, currencyCode)}
                      {commissionHint(wallet, currencyCode) ? ` · ${commissionHint(wallet, currencyCode)}` : ''}
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

            <div className="workflow-footer-links">
              <Link to="/operator/transactions"><Receipt size={14} /> Transaction reports</Link>
              <Link to="/operator/create">Create account</Link>
              <Link to="/operator/customers?mode=topup">Topup</Link>
              <Link to="/operator/customers?mode=subscribe">Subscribe</Link>
            </div>
          </div>

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
        </div>
      )}
    </Layout>
  );
}
