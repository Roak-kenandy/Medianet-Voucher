import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Gauge, FileText, CheckCircle, Clock, Package, UserPlus, Upload, XCircle, Loader } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ChartCard from '../../components/charts/ChartCard';
import DonutChart from '../../components/charts/DonutChart';
import BarChart from '../../components/charts/BarChart';
import { operatorApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_ORDER = ['created', 'pending', 'processing', 'failed'];

function sortStatusBreakdown(items = []) {
  return [...items].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  );
}

function QuotaCard({ stats }) {
  const used = stats?.accountsCreated || 0;
  const total = stats?.accountQuota || 0;
  const remaining = stats?.remainingQuota || 0;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;

  let barClass = '';
  if (percent >= 90) barClass = 'danger';
  else if (percent >= 70) barClass = 'warning';

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 className="card-title">Account Quota</h3>
            <p className="card-subtitle">
              {remaining.toLocaleString()} of {total.toLocaleString()} remaining
            </p>
          </div>
          <div className="stat-card-icon">
            <Gauge size={20} />
          </div>
        </div>
        <div className="progress-bar">
          <div
            className={`progress-bar-fill ${barClass}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
          {used.toLocaleString()} accounts created ({percent}% used)
        </p>
      </div>
    </div>
  );
}

export default function OperatorDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    operatorApi
      .getStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const charts = stats?.charts;
  const statusBreakdown = sortStatusBreakdown(charts?.statusBreakdown || []);
  const activityTotal = charts?.activityTrend?.reduce((sum, row) => sum + row.count, 0) || 0;

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          {today} · {user?.clientName || stats?.clientName}
          {stats?.packageType && (
            <span className="badge badge-info" style={{ marginLeft: 8 }}>{stats.packageType}</span>
          )}
        </p>
      </div>

      {loading ? (
        <div className="loading-screen" style={{ height: 200 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          {(stats?.remainingQuota ?? 0) > 0 && (
            <div className="quick-actions">
              <Link to="/operator/create" className="btn btn-primary">
                <UserPlus size={18} /> Create Account
              </Link>
              <Link to="/operator/bulk" className="btn btn-secondary">
                <Upload size={18} /> Bulk Upload
              </Link>
              <Link to="/operator/accounts" className="btn btn-secondary">
                <FileText size={18} /> View Accounts
              </Link>
            </div>
          )}

          <QuotaCard stats={stats} />

          <div className="dashboard-charts">
            <ChartCard
              title="Account Activity"
              subtitle={`Accounts created per day · last 30 days · ${activityTotal} total`}
              className="chart-card-wide"
            >
              <BarChart data={charts?.activityTrend || []} height={200} />
            </ChartCard>

            <ChartCard
              title="Account Status"
              subtitle="Breakdown of all your voucher records"
            >
              <DonutChart
                data={statusBreakdown}
                centerValue={stats?.statusCounts?.total || 0}
                centerLabel="Total"
              />
            </ChartCard>

            <ChartCard
              title="Quota Usage"
              subtitle="Used vs remaining allocation"
            >
              <DonutChart
                data={charts?.quotaBreakdown || []}
                centerValue={`${stats?.accountQuota > 0 ? Math.round((stats.accountsCreated / stats.accountQuota) * 100) : 0}%`}
                centerLabel="Used"
              />
            </ChartCard>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Package</span>
                <div className="stat-card-icon"><Package size={20} /></div>
              </div>
              <div className="stat-card-value" style={{ fontSize: 18 }}>{stats?.packageType || 'OTT'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Total Records</span>
                <div className="stat-card-icon"><FileText size={20} /></div>
              </div>
              <div className="stat-card-value">{stats?.statusCounts?.total || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Created</span>
                <div className="stat-card-icon"><CheckCircle size={20} /></div>
              </div>
              <div className="stat-card-value">{stats?.statusCounts?.created || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Pending</span>
                <div className="stat-card-icon"><Clock size={20} /></div>
              </div>
              <div className="stat-card-value">{stats?.statusCounts?.pending || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Processing</span>
                <div className="stat-card-icon"><Loader size={20} /></div>
              </div>
              <div className="stat-card-value">{stats?.statusCounts?.processing || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-header">
                <span className="stat-card-label">Failed</span>
                <div className="stat-card-icon"><XCircle size={20} /></div>
              </div>
              <div className="stat-card-value">{stats?.statusCounts?.failed || 0}</div>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
