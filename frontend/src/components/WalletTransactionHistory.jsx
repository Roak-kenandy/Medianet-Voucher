import { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import TablePagination from './TablePagination';
import { operatorApi } from '../api/client';
import { formatMoney } from '../utils/money';

function TypeBadge({ type, status, activity }) {
  const label = activity || (status === 'pending' ? `${type} (pending)` : type);
  const map = {
    topup: 'badge-success',
    debit: 'badge-danger',
    adjustment: 'badge-info',
    refund: 'badge-warning',
  };
  return <span className={`badge ${map[type] || 'badge-neutral'}`}>{label}</span>;
}

function NetAmount({ tx }) {
  const formatted = formatMoney(tx.netAmount, tx.currencyCode);
  if (tx.type === 'debit') {
    return (
      <span style={{ color: 'var(--color-danger)' }}>
        <ArrowUpRight size={14} style={{ verticalAlign: -2 }} /> {formatted}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--color-success)' }}>
      <ArrowDownLeft size={14} style={{ verticalAlign: -2 }} /> {formatted}
    </span>
  );
}

function TransactionDescription({ tx }) {
  if (tx.type === 'topup' && tx.gstAmount != null) {
    return (
      <>
        Paid {formatMoney(tx.amountPaid ?? tx.amount, tx.currencyCode)}
        {' · GST '}
        {tx.gstRatePercent != null ? `${tx.gstRatePercent}%` : ''}
        {' (−'}
        {formatMoney(tx.gstAmount, tx.currencyCode)}
        {') · Credited '}
        {formatMoney(tx.netAmount, tx.currencyCode)}
      </>
    );
  }
  return tx.description || '—';
}

function TransactionCard({ tx, detailed }) {
  return (
    <div className="data-card">
      <div className="data-card-title">{new Date(tx.createdAt).toLocaleString()}</div>
      <div className="data-card-row">
        <span className="data-card-label">Activity</span>
        <span className="data-card-value">
          <TypeBadge type={tx.type} status={tx.status} activity={tx.activity} />
        </span>
      </div>
      {detailed && tx.customerName && (
        <div className="data-card-row">
          <span className="data-card-label">Customer</span>
          <span className="data-card-value">{tx.customerName}</span>
        </div>
      )}
      {detailed && tx.phoneNumber && (
        <div className="data-card-row">
          <span className="data-card-label">Phone</span>
          <span className="data-card-value">{tx.phoneNumber}</span>
        </div>
      )}
      {detailed && (tx.packageNames || []).length > 0 && (
        <div className="data-card-row">
          <span className="data-card-label">Packages</span>
          <span className="data-card-value">{(tx.packageNames || []).join(', ')}</span>
        </div>
      )}
      <div className="data-card-row">
        <span className="data-card-label">Amount</span>
        <span className="data-card-value">{formatMoney(tx.amount, tx.currencyCode)}</span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Net</span>
        <span className="data-card-value"><NetAmount tx={tx} /></span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Balance</span>
        <span className="data-card-value">
          {formatMoney(tx.balanceBefore, tx.currencyCode)}
          {' → '}
          {formatMoney(tx.balanceAfter, tx.currencyCode)}
        </span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Reference</span>
        <span className="data-card-value">{tx.reference}</span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Details</span>
        <span className="data-card-value" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <TransactionDescription tx={tx} />
        </span>
      </div>
    </div>
  );
}

export default function WalletTransactionHistory({
  startDate,
  endDate,
  type,
  detailed = false,
} = {}) {
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, type]);

  useEffect(() => {
    setLoading(true);
    operatorApi
      .getWalletTransactions({
        page,
        limit: 20,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        type: type || undefined,
      })
      .then((result) => {
        setTransactions(result.transactions);
        setPagination(result.pagination);
      })
      .finally(() => setLoading(false));
  }, [page, startDate, endDate, type]);

  if (loading) {
    return (
      <div className="loading-screen" style={{ height: 180 }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return <div className="empty-state"><p>No wallet transactions yet</p></div>;
  }

  return (
    <>
      <div className="table-wrapper table-mobile-hide">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              {detailed && <th>Customer</th>}
              {detailed && <th>Phone</th>}
              {detailed && <th>Packages</th>}
              <th>Amount</th>
              <th>Net</th>
              <th>Balance Before</th>
              <th>Balance After</th>
              <th>Reference</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{new Date(tx.createdAt).toLocaleString()}</td>
                <td><TypeBadge type={tx.type} status={tx.status} activity={tx.activity} /></td>
                {detailed && <td>{tx.customerName || '—'}</td>}
                {detailed && <td>{tx.phoneNumber || '—'}</td>}
                {detailed && <td>{(tx.packageNames || []).join(', ') || '—'}</td>}
                <td>{formatMoney(tx.amount, tx.currencyCode)}</td>
                <td><NetAmount tx={tx} /></td>
                <td>{formatMoney(tx.balanceBefore, tx.currencyCode)}</td>
                <td>{formatMoney(tx.balanceAfter, tx.currencyCode)}</td>
                <td style={{ fontSize: 13 }}>{tx.reference}</td>
                <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  <TransactionDescription tx={tx} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="data-cards">
        {transactions.map((tx) => (
          <TransactionCard key={tx.id} tx={tx} detailed={detailed} />
        ))}
      </div>

      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        limit={pagination.limit}
        onPageChange={setPage}
        itemLabel="transactions"
      />
    </>
  );
}
