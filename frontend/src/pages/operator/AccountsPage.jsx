import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Download } from 'lucide-react';
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
import '../admin/admin-shared.css';

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
    bulk_create: 'badge-neutral',
    customer_crm_topup: 'badge-success',
    customer_topup: 'badge-success',
    create_account: 'badge-neutral',
  };
  return <span className={`badge ${map[activity] || 'badge-neutral'}`}>{label}</span>;
}

function AccountCard({ acc, packageLabel }) {
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
        <span className="data-card-value">{new Date(acc.created_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const toast = useToast();
  const [data, setData] = useState({ accounts: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activity, setActivity] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    setLoading(true);
    operatorApi
      .getAccounts({
        page,
        limit: 20,
        search,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        activity,
      })
      .then((accountsData) => setData(accountsData))
      .finally(() => setLoading(false));
  }, [page, search, startDate, endDate, activity]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await operatorApi.exportAccounts({
        search,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        activity,
      });
      downloadCsv(csv, 'customer-history.csv');
      toast.success('Customer history downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExportting(false);
    }
  };

  const { accounts, pagination } = data;

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

      <div className="card">
        <div className="card-header activation-report-header">
          <div>
            <h3 className="card-title">History</h3>
            <p className="card-subtitle">Filter by activity and date, then download the full report as CSV</p>
          </div>
          {pagination.total > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExport}
              disabled={exporting || loading}
            >
              <Download size={16} />
              {exporting ? 'Exporting…' : 'Download CSV'}
            </button>
          )}
        </div>

        <div className="activation-report-filters">
          <div className="form-group">
            <label htmlFor="historyActivity" className="form-label">Activity</label>
            <select
              id="historyActivity"
              className="form-input"
              value={activity}
              onChange={(e) => {
                setActivity(e.target.value);
                setPage(1);
              }}
            >
              {CUSTOMER_HISTORY_ACTIVITY_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="accountsStartDate" className="form-label">Start date</label>
            <input
              id="accountsStartDate"
              type="date"
              className="form-input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="accountsEndDate" className="form-label">End date</label>
            <input
              id="accountsEndDate"
              type="date"
              className="form-input"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <TableToolbar
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name, phone, activity, or reference..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">
                {search || startDate || endDate || activity !== 'all'
                  ? 'No customers match your filters'
                  : 'No customer history yet'}
              </p>
              <p>
                {search || startDate || endDate || activity !== 'all'
                  ? 'Try a different filter or search term'
                  : 'Actions from Create Account, Topup & Subscribe, and bulk upload appear here'}
              </p>
              {!search && !startDate && !endDate && activity === 'all' && (
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
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => {
                      const packages = accountPackageLabel(acc);
                      return (
                        <tr key={acc.id}>
                          <td>{new Date(acc.created_at).toLocaleString()}</td>
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
                  />
                ))}
              </div>

              <TablePagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={pagination.limit}
                onPageChange={setPage}
                itemLabel="records"
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
