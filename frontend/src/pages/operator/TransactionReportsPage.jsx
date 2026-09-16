import { useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import WalletTransactionHistory from '../../components/WalletTransactionHistory';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatMoney } from '../../utils/money';
import { getDefaultReportDateRange } from '../../utils/dates';
import { downloadCsv } from '../../utils/reports';
import '../admin/admin-shared.css';

export default function TransactionReportsPage() {
  const toast = useToast();
  const defaultRange = getDefaultReportDateRange();
  const [filters, setFilters] = useState({
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    type: '',
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const buildParams = () => ({
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    type: filters.type || undefined,
  });

  const generate = async () => {
    setLoading(true);
    try {
      const data = await operatorApi.generateTransactionReport(buildParams());
      setReport(data);
      toast.success(`Report generated — ${data.rows?.length || 0} transaction(s)`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    try {
      const csv = await operatorApi.exportTransactionReport(buildParams());
      downloadCsv(csv, 'wallet-transaction-report.csv');
      toast.success('Report downloaded — open in Excel');
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Transaction Reports</h1>
        <p className="page-subtitle">
          Detailed wallet history — top-ups, create account charges, and customer top-ups
        </p>
      </div>

      <div className="card reports-panel" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="reports-filters" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="form-group">
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Date</label>
              <input
                type="date"
                className="form-input"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select
                className="form-input"
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              >
                <option value="">All types</option>
                <option value="topup">Wallet top-up</option>
                <option value="debit">Customer charge</option>
                <option value="adjustment">Adjustment</option>
              </select>
            </div>
          </div>

          <div className="reports-actions">
            <button className="btn btn-primary" onClick={generate} disabled={loading}>
              <Receipt size={18} />
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
            {(report?.rows?.length > 0 || report?.summary) && (
              <button className="btn btn-secondary" onClick={exportCsv}>
                <Download size={18} /> Download Excel (CSV)
              </button>
            )}
          </div>
        </div>
      </div>

      {report?.summary && (
        <div className="reports-summary">
          <div className="stat-card">
            <div className="stat-card-label">Total Transactions</div>
            <div className="stat-card-value">{report.summary.totalTransactions}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Wallet Top-ups</div>
            <div className="stat-card-value">{report.summary.totalTopups}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Total Credited</div>
            <div className="stat-card-value">
              {formatMoney(report.summary.totalCredited, report.summary.currencyCode)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Create Account Charges</div>
            <div className="stat-card-value">
              {formatMoney(report.summary.createAccountCharges, report.summary.currencyCode)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Customer Top-up Charges</div>
            <div className="stat-card-value">
              {formatMoney(report.summary.customerTopupCharges, report.summary.currencyCode)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Total Debited</div>
            <div className="stat-card-value">
              {formatMoney(report.summary.totalDebited, report.summary.currencyCode)}
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3 className="card-title">Report Results</h3>
            <p className="card-subtitle">Generated {new Date(report.generatedAt).toLocaleString()}</p>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {report.rows.length === 0 ? (
              <div className="empty-state"><p>No transactions found for the selected period</p></div>
            ) : (
              <div className="table-wrapper reports-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Activity</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Packages</th>
                      <th>Amount</th>
                      <th>Balance Before</th>
                      <th>Balance After</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.date).toLocaleString()}</td>
                        <td>{row.activity}</td>
                        <td>{row.customerName || '—'}</td>
                        <td>{row.phoneNumber || '—'}</td>
                        <td>{(row.packageNames || []).join(', ') || '—'}</td>
                        <td>{formatMoney(row.netAmount, row.currencyCode)}</td>
                        <td>{formatMoney(row.balanceBefore, row.currencyCode)}</td>
                        <td>{formatMoney(row.balanceAfter, row.currencyCode)}</td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                          {row.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Transactions</h3>
          <p className="card-subtitle">Latest wallet activity with customer and package details</p>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <WalletTransactionHistory
            startDate={filters.startDate}
            endDate={filters.endDate}
            type={filters.type}
            detailed
          />
        </div>
      </div>
    </Layout>
  );
}
