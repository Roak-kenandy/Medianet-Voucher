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
import { getDefaultReportDateRange } from '../../utils/dates';
import { downloadCsv } from '../../utils/reports';
import '../admin/admin-shared.css';

function StatusBadge({ status }) {
  const map = {
    registered: 'badge-neutral',
    pending: 'badge-warning',
    processing: 'badge-info',
    created: 'badge-success',
    failed: 'badge-danger',
  };
  return (
    <span className={`badge ${map[status] || 'badge-neutral'}`}>
      {status}
    </span>
  );
}

function AccountCard({ acc, packageLabel }) {
  return (
    <div className="data-card">
      <div className="data-card-title">{acc.full_name}</div>
      <div className="data-card-row">
        <span className="data-card-label">Phone</span>
        <span className="data-card-value">{acc.phone_number}</span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Package</span>
        <span className="data-card-value">
          <span className="badge badge-info">{packageLabel}</span>
        </span>
      </div>
      <div className="data-card-row">
        <span className="data-card-label">Status</span>
        <span className="data-card-value"><StatusBadge status={acc.status} /></span>
      </div>
      {acc.status === 'failed' && acc.error_message && (
        <div className="data-card-row">
          <span className="data-card-label">Error</span>
          <span className="data-card-value error-cell">{acc.error_message}</span>
        </div>
      )}
      {acc.external_ref && (
        <div className="data-card-row">
          <span className="data-card-label">Reference</span>
          <span className="data-card-value">{acc.external_ref}</span>
        </div>
      )}
      <div className="data-card-row">
        <span className="data-card-label">Created</span>
        <span className="data-card-value">{new Date(acc.created_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [data, setData] = useState({ accounts: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);

  useEffect(() => {
    setLoading(true);
    operatorApi
      .getAccounts({ page, limit: 20, search, startDate, endDate })
      .then((accountsData) => setData(accountsData))
      .finally(() => setLoading(false));
  }, [page, search, startDate, endDate]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await operatorApi.exportAccounts({ search, startDate, endDate });
      downloadCsv(csv, 'accounts-report.csv');
      toast.success('Accounts report downloaded');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const { accounts, pagination } = data;

  const accountPackageLabel = (acc) =>
    acc.package_names || acc.package_name || formatPackageLabel('');

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Accounts</h1>
        <p className="page-subtitle">View and download all voucher accounts you have created</p>
      </div>

      <div className="card">
        <div className="card-header activation-report-header">
          <div>
            <h3 className="card-title">Account list</h3>
            <p className="card-subtitle">Filter by date range and search, then download the full report as CSV</p>
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
          placeholder="Search by name, phone, or status..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">
                {search || startDate || endDate ? 'No accounts match your filters' : 'No accounts yet'}
              </p>
              <p>
                {search || startDate || endDate
                  ? 'Try a different date range or search term'
                  : 'Create your first account to see it here'}
              </p>
              {!search && !startDate && !endDate && (
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
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Package</th>
                      <th>Status</th>
                      <th>Details</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.id}>
                        <td style={{ fontWeight: 500 }}>{acc.full_name}</td>
                        <td>{acc.phone_number}</td>
                        <td>
                          <span className="badge badge-info">{accountPackageLabel(acc)}</span>
                        </td>
                        <td><StatusBadge status={acc.status} /></td>
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
                        <td>{new Date(acc.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="data-cards">
                {accounts.map((acc) => (
                  <AccountCard key={acc.id} acc={acc} packageLabel={accountPackageLabel(acc)} />
                ))}
              </div>

              <TablePagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={pagination.limit}
                onPageChange={setPage}
                itemLabel="accounts"
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
