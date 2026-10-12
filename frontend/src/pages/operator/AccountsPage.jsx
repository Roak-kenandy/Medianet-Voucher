import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Download, Receipt, MessageSquare } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatPackageLabel } from '../../constants/packages';
import {
  CUSTOMER_HISTORY_ACTIVITY_FILTERS,
  customerHistoryActivityLabel,
  customerHistoryServiceLabel,
} from '../../constants/customerHistory';
import { formatMoney } from '../../utils/money';
import { downloadCsv } from '../../utils/reports';
import { getDefaultReportDateRange } from '../../utils/dates';
import '../admin/admin-shared.css';
import { formatDateTime } from '../../constants/appSettings';
import Select from '../../components/ui/Select';
import DateRangePicker from '../../components/ui/DateRangePicker';

function StatusBadge({ status }) {
  const map = {
    registered: 'badge-neutral',
    pending: 'badge-warning',
    processing: 'badge-info',
    created: 'badge-success',
    completed: 'badge-success',
    failed: 'badge-danger',
  };
  return (
    <span className={`badge ${map[status] || 'badge-neutral'}`}>
      {status === 'completed' ? 'completed' : status}
    </span>
  );
}

function ActivityBadge({ activity }) {
  const label = customerHistoryActivityLabel(activity);
  const map = {
    customer_subscribe: 'badge-info',
    customer_renew: 'badge-info',
    customer_upgrade: 'badge-info',
    bulk_create: 'badge-neutral',
    customer_crm_topup: 'badge-success',
    customer_topup: 'badge-success',
    create_account: 'badge-neutral',
  };
  return <span className={`badge ${map[activity] || 'badge-neutral'}`}>{label}</span>;
}

function ResendLoginButton({ acc, sending, onResend }) {
  if (!acc.phone_number) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() => onResend(acc)}
      disabled={sending}
      title={`Send login details by SMS to ${acc.phone_number}`}
      style={{ whiteSpace: 'nowrap' }}
    >
      <MessageSquare size={14} />
      {sending ? 'Sending…' : 'Resend Login'}
    </button>
  );
}

function AccountCard({ acc, packageLabel, sending, onResend }) {
  return (
    <div className="data-card">
      <div className="data-card-title">{acc.full_name}</div>
      <div className="data-card-row">
        <span className="data-card-label">Activity</span>
        <span className="data-card-value">
          <ActivityBadge activity={acc.activity} />
        </span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Phone</span>
        <span className="data-card-value">{acc.phone_number}</span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Service</span>
        <span className="data-card-value">{customerHistoryServiceLabel(acc.service_tag)}</span>
      </div>
      {packageLabel && packageLabel !== '—' && (
        <div className="data-card-row">
          <span className="data-card-label">Package</span>
          <span className="data-card-value">
            <span className="badge badge-info">{packageLabel}</span>
          </span>
        </div>
      )}
      <div className="data-card-row">
        <span className="data-card-label">Status</span>
        <span className="data-card-value"><StatusBadge status={acc.status} /></span>
      </div>
      {acc.amount_charged != null && Number(acc.amount_charged) > 0 && (
        <div className="data-card-row">
          <span className="data-card-label">Charged</span>
          <span className="data-card-value">{formatMoney(acc.amount_charged, 'MVR')}</span>
        </div>
      )}
      {acc.status === 'failed' && acc.error_message && (
        <div className="data-card-row">
          <span className="data-card-label">Error</span>
          <span className="data-card-value error-cell">{acc.error_message}</span>
        </div>
      )}
      {(acc.external_ref || acc.wallet_reference) && (
        <div className="data-card-row">
          <span className="data-card-label">Reference</span>
          <span className="data-card-value">{acc.external_ref || acc.wallet_reference}</span>
        </div>
      )}
      <div className="data-card-row">
        <span className="data-card-label">Date</span>
        <span className="data-card-value">{formatDateTime(acc.created_at)}</span>
      </div>
      {acc.phone_number && (
        <div className="data-card-row">
          <span className="data-card-label">Login</span>
          <span className="data-card-value">
            <ResendLoginButton acc={acc} sending={sending} onResend={onResend} />
          </span>
        </div>
      )}
    </div>
  );
}

const REPORT_PAGE_SIZE = 20;

function toApiParams({ startDate, endDate, activity }) {
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    activity: activity || 'all',
  };
}

export default function AccountsPage() {
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [filters, setFilters] = useState({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    activity: 'all',
  });
  const [applied, setApplied] = useState(null);
  const [data, setData] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [resendingId, setResendingId] = useState(null);

  const handleResendLogin = async (acc) => {
    if (resendingId) return;
    const who = acc.full_name ? `${acc.full_name} (${acc.phone_number})` : acc.phone_number;
    if (!window.confirm(`Send login details by SMS to ${who}?`)) return;
    setResendingId(acc.id);
    try {
      const result = await operatorApi.resendLogin(acc.id);
      toast.success(result?.message || `Login details sent to ${acc.phone_number}`);
    } catch (err) {
      toast.error(err.message || 'Failed to send login SMS');
    } finally {
      setResendingId(null);
    }
  };

  const loadReport = useCallback(
    async (params, { pageNum = 1, searchTerm = '', announce = false } = {}) => {
      setLoading(true);
      try {
        const result = await operatorApi.getAccounts({
          ...toApiParams(params),
          page: pageNum,
          limit: REPORT_PAGE_SIZE,
          search: searchTerm,
        });
        setData(result);
        setApplied(params);
        setGeneratedAt(new Date().toISOString());
        if (announce) {
          toast.success(`Report generated — ${result.pagination?.total ?? 0} record(s)`);
        }
      } catch (err) {
        toast.error(err.message || 'Failed to generate report');
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    loadReport(filters);
    // Initial load only: later filter changes apply when Generate Report is clicked.
  }, []);

  const generate = () => {
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      toast.error('Start date must be on or before the end date');
      return;
    }
    setSearch('');
    loadReport(filters, { announce: true });
  };

  const handleSearchChange = (value) => {
    setSearch(value);
    if (applied) loadReport(applied, { searchTerm: value });
  };

  const handlePageChange = (nextPage) => {
    if (applied) loadReport(applied, { pageNum: nextPage, searchTerm: search });
  };

  const handleExport = async () => {
    if (!applied) return;
    setExporting(true);
    try {
      const csv = await operatorApi.exportAccounts({ ...toApiParams(applied), search });
      downloadCsv(csv, 'customer-history.csv');
      toast.success('Report downloaded — open in Excel');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const accounts = data?.accounts || [];
  const pagination = data?.pagination || {};
  const hasFilters = Boolean(search) || (applied && applied.activity !== 'all');

  const accountPackageLabel = (acc) =>
    acc.package_names || acc.package_name || formatPackageLabel('');

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Customer History</h1>
        <p className="page-subtitle">
          New accounts, customer top-ups, and subscribe actions in one timeline
        </p>
      </div>

      <div className="card reports-panel" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="reports-filters reports-filters-2">
            <div className="form-group">
              <label htmlFor="accountsDateRange" className="form-label">Date range</label>
              <DateRangePicker
                id="accountsDateRange"
                startDate={filters.startDate}
                endDate={filters.endDate}
                onChange={(range) => setFilters({ ...filters, ...range })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="historyActivity" className="form-label">Activity</label>
              <Select
                id="historyActivity"
                className="form-input"
                value={filters.activity}
                onChange={(e) => setFilters({ ...filters, activity: e.target.value })}
              >
                {CUSTOMER_HISTORY_ACTIVITY_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="reports-actions">
            <button type="button" className="btn btn-primary" onClick={generate} disabled={loading}>
              <Receipt size={18} />
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
            {pagination.total > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                <Download size={18} />
                {exporting ? 'Exporting…' : 'Download Excel (CSV)'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Report Results</h3>
          <p className="card-subtitle">
            {generatedAt ? `Generated ${formatDateTime(generatedAt)}` : 'Choose a date range and click Generate Report'}
            {applied && (
              <>
                {' · '}
                {applied.startDate || 'All'} to {applied.endDate || 'All'}
                {applied.activity !== 'all' && ` · ${customerHistoryActivityLabel(applied.activity)}`}
              </>
            )}
            {pagination.total != null && ` · ${Number(pagination.total).toLocaleString()} record(s)`}
          </p>
        </div>

        {data && (
          <TableToolbar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, phone, activity, or reference..."
          />
        )}
        <div className="card-body" style={{ padding: 0 }}>
          {loading && !data ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">
                {hasFilters ? 'No customers match your filters' : 'No customer history for the selected period'}
              </p>
              <p>
                {hasFilters
                  ? 'Try a different filter or search term'
                  : 'Actions from Create Account, Topup & Subscribe, and bulk upload appear here'}
              </p>
              {!hasFilters && (
                <div className="empty-state-action">
                  <Link to="/operator/create" className="btn btn-primary">
                    <UserPlus size={18} />
                    Create Account
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrapper table-mobile-hide">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Activity</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Service</th>
                      <th>Packages</th>
                      <th>Status</th>
                      <th>Charged</th>
                      <th>Details</th>
                      <th>Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => {
                      const packages = accountPackageLabel(acc);
                      return (
                        <tr key={acc.id}>
                          <td>{formatDateTime(acc.created_at)}</td>
                          <td><ActivityBadge activity={acc.activity} /></td>
                          <td style={{ fontWeight: 500 }}>{acc.full_name}</td>
                          <td>{acc.phone_number}</td>
                          <td>{customerHistoryServiceLabel(acc.service_tag)}</td>
                          <td>
                            {packages && packages !== '—' ? (
                              <span className="badge badge-info">{packages}</span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            )}
                          </td>
                          <td><StatusBadge status={acc.status} /></td>
                          <td>
                            {acc.amount_charged != null && Number(acc.amount_charged) > 0
                              ? formatMoney(acc.amount_charged, 'MVR')
                              : '—'}
                          </td>
                          <td>
                            {acc.status === 'failed' && acc.error_message ? (
                              <span className="error-cell" title={acc.error_message}>
                                {acc.error_message}
                              </span>
                            ) : acc.external_ref ? (
                              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                Ref: {acc.external_ref}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <ResendLoginButton
                              acc={acc}
                              sending={resendingId === acc.id}
                              onResend={handleResendLogin}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="data-cards">
                {accounts.map((acc) => (
                  <AccountCard
                    key={acc.id}
                    acc={acc}
                    packageLabel={accountPackageLabel(acc)}
                    sending={resendingId === acc.id}
                    onResend={handleResendLogin}
                  />
                ))}
              </div>

              <TablePagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={pagination.limit}
                onPageChange={handlePageChange}
                itemLabel="records"
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
