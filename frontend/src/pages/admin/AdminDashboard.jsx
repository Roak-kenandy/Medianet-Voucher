import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserCheck, FileText, Activity, Plus, BarChart3 } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ChartCard from '../../components/charts/ChartCard';
import DonutChart from '../../components/charts/DonutChart';
import BarChart from '../../components/charts/BarChart';
import HorizontalBarChart from '../../components/charts/HorizontalBarChart';
import { adminApi } from '../../api/client';

const STATUS_ORDER = ['created', 'pending', 'processing', 'failed'];

function sortStatusBreakdown(items = []) {
  return [...items].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  );
}

function StatCard({ label, value, meta, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-card-label">{label}</span>
        <div className="stat-card-icon">
          <Icon size={20} />
        </div>
      </div>
      <div className="stat-card-value">{value ?? '—'}</div>
      {meta && <div className="stat-card-meta">{meta}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
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
    <Layout sidebar={<Sidebar role="admin" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{today} · Admin overview</p>
      </div>

      {loading ? (
        <div className="loading-screen" style={{ height: 200 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          <div className="quick-actions">
            <Link to="/admin/operators" className="btn btn-primary">
              <Plus size={18} /> Manage Operators
            </Link>
            <Link to="/admin/reports" className="btn btn-secondary">
              <BarChart3 size={18} /> View Reports
            </Link>
          </div>

          <div className="stats-grid">
            <StatCard
              label="Total Operators"
              value={stats?.totalOperators}
              meta="Registered client operators"
              icon={Users}
            />
            <StatCard
              label="Active Operators"
              value={stats?.activeOperators}
              meta="Currently enabled"
              icon={UserCheck}
            />
            <StatCard
              label="Accounts Created"
              value={stats?.totalAccountsCreated}
              meta="Across all operators"
              icon={FileText}
            />
            <StatCard
              label="Voucher Records"
              value={stats?.totalVoucherRecords}
              meta="Total in system"
              icon={Activity}
            />
          </div>

          <div className="dashboard-charts">
            <ChartCard
              title="Platform Activity"
              subtitle={`Accounts created per day · last 30 days · ${activityTotal} total`}
              className="chart-card-wide"
            >
              <BarChart data={charts?.activityTrend || []} height={200} color="var(--color-accent)" />
            </ChartCard>

            <ChartCard
              title="Account Status"
              subtitle="All voucher records across operators"
            >
              <DonutChart
                data={statusBreakdown}
                centerValue={stats?.totalVoucherRecords || 0}
                centerLabel="Total"
              />
            </ChartCard>

            <ChartCard
              title="Operator Status"
              subtitle="Active vs inactive client operators"
            >
              <DonutChart
                data={charts?.operatorStatus || []}
                centerValue={stats?.totalOperators || 0}
                centerLabel="Operators"
              />
            </ChartCard>

            <ChartCard
              title="Top Operators by Usage"
              subtitle="Accounts created vs quota"
              className="chart-card-wide"
            >
              <HorizontalBarChart data={charts?.operatorAccounts || []} />
            </ChartCard>
          </div>
        </>
      )}
    </Layout>
  );
}
