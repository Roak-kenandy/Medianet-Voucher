import { useCallback, useEffect, useState } from 'react';
import { Wallet, Search, Download } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasPermission } from '../../constants/permissions';
import { formatMoney } from '../../utils/money';
import { downloadCsv } from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import './admin-shared.css';

function formatTrialLabel(operator, wallet) {
  const limit = Number(wallet?.trialAccountLimit ?? operator?.trial_account_limit) || 0;
  const used = Number(wallet?.trialAccountsUsed ?? operator?.trial_accounts_used) || 0;
  if (limit <= 0) return 'No free accounts';
  const remaining = Math.max(0, limit - used);
  return `${remaining} of ${limit} free accounts left`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OperatorTopupPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canTopup = hasPermission(user?.role, 'adjustWallet');

  const [operators, setOperators] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState('');
  const [trialAccounts, setTrialAccounts] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const defaultReportRange = getDefaultReportDateRange();
  const [reportSearch, setReportSearch] = useState('');
  const [reportStartDate, setReportStartDate] = useState(defaultReportRange.startDate);
  const [reportEndDate, setReportEndDate] = useState(defaultReportRange.endDate);
  const [activations, setActivations] = useState([]);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [reportPagination, setReportPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  const loadActivations = useCallback(() => {
    setReportLoading(true);
    setReportError('');
    adminApi
      .getOperatorActivations({
        page: reportPage,
        limit: 20,
        search: reportSearch,
        startDate: reportStartDate,
        endDate: reportEndDate,
      })
      .then((result) => {
        setActivations(result.activations || []);
        setReportPagination(result.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
      })
      .catch((err) => {
        setActivations([]);
        setReportError(err.message || 'Failed to load activation report');
      })
      .finally(() => setReportLoading(false));
  }, [reportPage, reportSearch, reportStartDate, reportEndDate]);

  useEffect(() => {
    loadActivations();
  }, [loadActivations]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setOperators([]);
      setSearchLoading(false);
      return undefined;
    }

    setSearchLoading(true);
    const timer = setTimeout(() => {
      adminApi
        .getOperators({ page: 1, limit: 100, search: term })
        .then((result) => setOperators(result.operators || []))
        .catch(() => setOperators([]))
        .finally(() => setSearchLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!selectedOperator?.id) {
      setWallet(null);
      return;
    }

    adminApi
      .getOperatorWallet(selectedOperator.id)
      .then(setWallet)
      .catch(() => setWallet(null));
  }, [selectedOperator?.id]);

  const handleSelectOperator = (operator) => {
    setSelectedOperator(operator);
    setSearch(operator.client_name || operator.email || '');
    setOperators([]);
  };

  const handleClearSelection = () => {
    setSelectedOperator(null);
    setSearch('');
    setOperators([]);
    setWallet(null);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await adminApi.exportOperatorActivations({
        search: reportSearch,
        startDate: reportStartDate,
        endDate: reportEndDate,
      });
      downloadCsv(csv, 'operator-wallet-activations.csv');
      toast.success('Activation report downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canTopup) {
      toast.error('You do not have permission to activate operators');
      return;
    }

    const value = Number(amount);
    const trimmedNotes = notes.trim();

    if (!selectedOperator?.id || !value || value <= 0) {
      toast.error('Select an operator and enter a valid wallet credit amount');
      return;
    }

    if (trimmedNotes.length < 3) {
      toast.error('Notes are required (minimum 3 characters)');
      return;
    }

    setSubmitting(true);
    try {
      const result = await adminApi.topupOperator(selectedOperator.id, {
        amount: value,
        trialAccounts: Number(trialAccounts) || 0,
        notes: trimmedNotes,
      });

      toast.success(`Wallet activated for ${selectedOperator.client_name}`);
      setAmount('');
      setNotes('');
      setTrialAccounts('0');
      setWallet((prev) =>
        prev
          ? {
              ...prev,
              balance: result.balance,
              trialAccountLimit: result.trialAccountLimit,
              trialAccountsUsed: result.trialAccountsUsed,
              trialAccountsRemaining: result.trialAccountsRemaining,
              trialActive: result.trialActive,
            }
          : prev
      );
      setSelectedOperator((prev) =>
        prev
          ? {
              ...prev,
              wallet_balance: result.balance,
              trial_account_limit: result.trialAccountLimit,
              trial_accounts_used: result.trialAccountsUsed,
            }
          : prev
      );
      loadActivations();
    } catch (err) {
      toast.error(err.message || 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Operator Topup</h1>
        <p className="page-subtitle">
          Activate an operator wallet after payment is handled by finance. Notes are required for every activation.
        </p>
      </div>

      {!canTopup && (
        <div className="alert alert-info" style={{ marginBottom: 20 }}>
          Your role can view this page but cannot activate operators. Contact an Admin or Finance user.
        </div>
      )}

      <div className="card" style={{ marginBottom: 28 }}>
        <div className="card-header">
          <h3 className="card-title">
            <Wallet size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Activate operator wallet
          </h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="operatorSearch" className="form-label">Search operator</label>
              <div className="operator-search-field">
                <span className="operator-search-icon-wrap" aria-hidden="true">
                  <Search size={18} />
                </span>
                <input
                  id="operatorSearch"
                  type="text"
                  className="form-input operator-search-input"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (selectedOperator) setSelectedOperator(null);
                  }}
                  placeholder="Type client name or email (min 2 characters)"
                  autoComplete="off"
                />
              </div>
              <p className="form-hint">
                Search by client name, email, package, or notes — then pick from the results.
              </p>
            </div>

            {searchLoading && (
              <div className="operator-search-status">
                <span className="spinner" />
                Searching…
              </div>
            )}

            {!searchLoading && search.trim().length >= 2 && !selectedOperator && operators.length === 0 && (
              <div className="operator-search-empty">No operators match your search.</div>
            )}

            {!selectedOperator && operators.length > 0 && (
              <ul className="operator-search-results">
                {operators.map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      className="operator-search-result"
                      onClick={() => handleSelectOperator(op)}
                    >
                      <span className="operator-search-result-name">{op.client_name}</span>
                      <span className="operator-search-result-meta">
                        {op.email} · {formatMoney(op.wallet_balance, 'MVR')}
                        {!op.is_active ? ' · Inactive' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedOperator && (
              <div className="operator-selected-card">
                <div>
                  <strong>{selectedOperator.client_name}</strong>
                  <p className="operator-selected-meta">
                    {selectedOperator.email}
                    {' · '}
                    Balance {formatMoney(wallet?.balance ?? selectedOperator.wallet_balance, 'MVR')}
                    {' · '}
                    Free accounts: {formatTrialLabel(selectedOperator, wallet)}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleClearSelection}>
                  Change
                </button>
              </div>
            )}

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="topupAmount" className="form-label">Wallet credit amount (MVR)</label>
                <input
                  id="topupAmount"
                  type="number"
                  className="form-input"
                  min="1"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount to add to wallet"
                  required
                  disabled={!canTopup}
                />
                <p className="form-hint">
                  This is the exact amount added to the operator wallet. No GST or billing here.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="trialAccounts" className="form-label">Free account quota</label>
                <input
                  id="trialAccounts"
                  type="number"
                  className="form-input"
                  min="0"
                  max="10000"
                  step="1"
                  value={trialAccounts}
                  onChange={(e) => setTrialAccounts(e.target.value)}
                  disabled={!canTopup}
                />
                <p className="form-hint">
                  Optional. e.g. 10 lets the operator create 10 users without wallet charges.
                </p>
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="topupNotes" className="form-label">Notes (required)</label>
                <textarea
                  id="topupNotes"
                  className="form-input"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Payment reference, finance confirmation, or reason for activation"
                  required
                  minLength={3}
                  disabled={!canTopup}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canTopup || submitting || !selectedOperator?.id}
            >
              {submitting ? 'Activating…' : 'Activate wallet'}
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header activation-report-header">
          <div>
            <h3 className="card-title">Activation history</h3>
            <p className="card-subtitle">
              Audit trail of staff wallet activations — operator, amount, staff user, and notes
            </p>
          </div>
          {reportPagination.total > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExport}
              disabled={exporting || reportLoading}
            >
              <Download size={16} />
              {exporting ? 'Exporting…' : 'Download CSV'}
            </button>
          )}
        </div>
        <div className="activation-report-filters">
          <div className="form-group">
            <label htmlFor="activationStartDate" className="form-label">Start date</label>
            <input
              id="activationStartDate"
              type="date"
              className="form-input"
              value={reportStartDate}
              onChange={(e) => {
                setReportStartDate(e.target.value);
                setReportPage(1);
              }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="activationEndDate" className="form-label">End date</label>
            <input
              id="activationEndDate"
              type="date"
              className="form-input"
              value={reportEndDate}
              onChange={(e) => {
                setReportEndDate(e.target.value);
                setReportPage(1);
              }}
            />
          </div>
        </div>
        <TableToolbar
          value={reportSearch}
          onChange={(value) => {
            setReportSearch(value);
            setReportPage(1);
          }}
          placeholder="Search activations by operator, staff, or notes..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {reportError && !reportLoading && (
            <div className="alert alert-danger" style={{ margin: 16 }}>
              {reportError}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 12 }}
                onClick={loadActivations}
              >
                Retry
              </button>
            </div>
          )}
          {reportLoading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : activations.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No activations found</p>
              <p>
                {reportSearch || reportStartDate || reportEndDate
                  ? 'Try a different date range or search term'
                  : 'Activations will appear here after staff credit operator wallets'}
              </p>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Operator</th>
                      <th>Amount</th>
                      <th>Activated by</th>
                      <th>Notes</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activations.map((row) => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{row.operatorName}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{row.operatorEmail}</div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{formatMoney(row.amount, row.currencyCode)}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{row.staffName}</div>
                          {row.staffEmail && (
                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{row.staffEmail}</div>
                          )}
                        </td>
                        <td style={{ maxWidth: 280, wordBreak: 'break-word' }}>{row.notes}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{row.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={reportPagination.page}
                totalPages={reportPagination.totalPages}
                total={reportPagination.total}
                limit={reportPagination.limit}
                onPageChange={setReportPage}
                itemLabel="activations"
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
