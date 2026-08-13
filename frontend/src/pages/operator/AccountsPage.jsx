import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { operatorApi } from '../../api/client';
import { formatPackageLabel } from '../../constants/packages';

function StatusBadge({ status }) {
  const map = {
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
  const [data, setData] = useState({ accounts: [], pagination: {}, packageType: '' });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      operatorApi.getAccounts({ page, limit: 20, search }),
      operatorApi.getStats(),
    ])
      .then(([accountsData, stats]) => {
        setData({
          ...accountsData,
          packageType: stats.packageType,
        });
      })
      .finally(() => setLoading(false));
  }, [page, search]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const { accounts, pagination } = data;
  const packageLabel = formatPackageLabel(data.packageType);

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Accounts</h1>
        <p className="page-subtitle">View all voucher accounts you have created</p>
      </div>

      <div className="card">
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
                {search ? 'No accounts match your search' : 'No accounts yet'}
              </p>
              <p>{search ? 'Try a different search term' : 'Create your first account to see it here'}</p>
              {!search && (
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
                          <span className="badge badge-info">{packageLabel}</span>
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
                  <AccountCard key={acc.id} acc={acc} packageLabel={packageLabel} />
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
