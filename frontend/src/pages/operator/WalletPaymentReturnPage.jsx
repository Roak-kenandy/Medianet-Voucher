import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import WalletPaymentStatusCard from '../../components/operator/WalletPaymentStatusCard';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import '../admin/admin-shared.css';
import './operator-workflow.css';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40;

function normalizePhase(result) {
  if (!result || typeof result !== 'object') return 'error';

  const status = String(result.status || '').toLowerCase();
  const bmlState = String(result.bmlState || '').toUpperCase();

  if (status === 'completed') return 'completed';
  if (status === 'cancelled' || bmlState === 'CANCELLED') return 'cancelled';
  if (status === 'failed' || ['FAILED', 'EXPIRED', 'VOIDED'].includes(bmlState)) {
    return 'failed';
  }
  if (status === 'pending' || bmlState === 'QR_CODE_GENERATED' || bmlState === 'INITIATED') {
    return 'confirming';
  }
  return 'confirming';
}

export default function WalletPaymentReturnPage() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState('confirming');
  const [details, setDetails] = useState(null);

  const reference =
    searchParams.get('reference') || sessionStorage.getItem('pendingTopupReference') || '';
  const bmlTransactionId = searchParams.get('transactionId') || undefined;

  useEffect(() => {
    if (!reference) {
      setPhase('missing');
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let timerId = null;

    const poll = async () => {
      if (cancelled) return;

      try {
        const result = await operatorApi.getWalletTopupStatus(reference, bmlTransactionId);

        if (cancelled) return;

        setDetails(result);
        const nextPhase = normalizePhase(result);

        if (nextPhase === 'completed') {
          setPhase('completed');
          sessionStorage.removeItem('pendingTopupReference');
          toastRef.current.success('Wallet topped up successfully');
          return;
        }

        if (nextPhase === 'cancelled' || nextPhase === 'failed') {
          setPhase(nextPhase);
          sessionStorage.removeItem('pendingTopupReference');
          return;
        }

        setPhase('confirming');
        attempts += 1;

        if (attempts >= MAX_POLLS) {
          setPhase('pending');
          return;
        }

        timerId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        toastRef.current.error(err.message || 'Unable to verify payment status');
      }
    };

    setPhase('confirming');
    poll();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [reference, bmlTransactionId]);

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="workflow-page-header">
        <div>
          <h1 className="page-title">Payment status</h1>
          <p className="page-subtitle">Bank of Maldives wallet top-up</p>
        </div>
      </div>

      <section className="workflow-step wallet-payment-return">
        <WalletPaymentStatusCard
          phase={phase}
          reference={reference || details?.reference}
          amount={details?.amountPaid ?? details?.amount}
          credited={details?.credited ?? details?.netAmount}
          balance={details?.balance}
        />

        {(phase === 'confirming' || phase === 'pending') && (
          <div className="workflow-footer-links wallet-payment-return-links">
            <Link to="/operator/wallet">Wallet</Link>
            <span aria-hidden="true">·</span>
            <Link to="/operator/transactions">Transaction reports</Link>
          </div>
        )}
      </section>
    </Layout>
  );
}
