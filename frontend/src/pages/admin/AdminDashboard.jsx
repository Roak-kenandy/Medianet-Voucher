import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  UserCheck,
  FileText,
  Activity,
  Plus,
  BarChart3,
  Wallet,
  TrendingUp,
  CreditCard,
} from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ChartCard from '../../components/charts/ChartCard';
import DonutChart from '../../components/charts/DonutChart';
import BarChart from '../../components/charts/BarChart';
import HorizontalBarChart from '../../components/charts/HorizontalBarChart';
import { adminApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../constants/permissions';
import { formatMoney } from '../../utils/money';

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
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const isSalesFocused = user?.role === 'sales' || user?.role === 'finance';
  const salesPeriod = stats?.sales?.periodDays || 30;
  const currency = stats?.sales?.currencyCode || 'MVR';

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
  const sales = stats?.sales;
  const statusBreakdown = sortStatusBreakdown(charts?.statusBreakdown || []);
  const activityTotal = charts?.activityTrend?.reduce((sum, row) => sum + row.count, 0) || 0;
  const topupTrendTotal =
    charts?.topupCollectedTrend?.reduce((sum, row) => sum + (row.count || 0), 0) || 0;
  const spendTrendTotal =
    charts?.walletSpendTrend?.reduce((sum, row) => sum + (row.count || 0), 0) || 0;

  const overviewSubtitle = isSalesFocused
    ? `${today} · ${ROLE_LABELS[user?.role] || 'Staff'} · sales & platform overview`
    : `${today} · ${ROLE_LABELS[user?.role] || 'Admin'} overview`;

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{overviewSubtitle}</p>
      </div>

      {loading ? (
        <div className="loading-screen" style={{ height: 200 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          <div className="quick-actions">
            {user?.role !== 'finance' && (
              <Link to="/admin/operators" className="btn btn-primary">
                <Plus size={18} /> Manage Operators
              </Link>
            )}
            <Link
              to={isSalesFocused ? '/admin/reports?type=sales_report' : '/admin/reports'}
              className="btn btn-secondary"
            >
              <BarChart3 size={18} />
              {isSalesFocused ? 'Sales Report' : 'View Reports'}
            </Link>
          </div>

          <div className="stats-grid">
            <StatCard
              label={`Top-up Collected (${salesPeriod}d)`}
              value={formatMoney(sales?.totalAmountPaid, currency)}
              meta="Operator wallet top-ups (online + manual)"
              icon={CreditCard}
            />
            <StatCard
              label={`Wallet Spend (${salesPeriod}d)`}
              value={formatMoney(sales?.totalWalletSpend, currency)}
              meta="Customer activations charged to wallets"
              icon={Wallet}
            />
            <StatCard
              label={`Credited to Wallets (${salesPeriod}d)`}
              value={formatMoney(sales?.totalCredited, currency)}
              meta={`${sales?.totalOnlineTopups || 0} online · ${sales?.totalManualTopups || 0} manual`}
              icon={TrendingUp}
            />
            <StatCard
              label={`Accounts (${salesPeriod}d)`}
              value={sales?.totalAccountsCreated}
              meta={formatMoney(sales?.totalAmountCharged, currency) + ' charged'}
              icon={FileText}
            />
          </div>

          <div className="dashboard-charts">
            <ChartCard
              title="Top-up Collections"
              subtitle={`Amount paid per day · last ${salesPeriod} days · ${formatMoney(topupTrendTotal, currency)} total`}
              className="chart-card-wide"
            >
              <BarChart
                data={charts?.topupCollectedTrend || []}
                height={200}
                color="var(--color-primary)"
              />
            </ChartCard>

            <ChartCard
              title="Wallet Spend"
              subtitle={`Customer charges per day · last ${salesPeriod} days · ${formatMoney(spendTrendTotal, currency)} total`}
              className="chart-card-wide"
            >
              <BarChart
                data={charts?.walletSpendTrend || []}
                height={200}
                color="var(--color-accent)"
              />
            </ChartCard>

            <ChartCard
              title="Top Operators by Sales"
              subtitle={`Top-up collected in the last ${salesPeriod} days`}
              className="chart-card-wide"
            >
              <HorizontalBarChart
                data={charts?.topOperatorsBySales || []}
                valueKey="topupPaid"
                maxKey="walletSpend"
              />
            </ChartCard>

            {!isSalesFocused && (
              <>
                <ChartCard
                  title="Platform Activity"
                  subtitle={`Accounts created per day · last 30 days · ${activityTotal} total`}
                  className="chart-card-wide"
                >
                  <BarChart data={charts?.activityTrend || []} height={200} color="var(--color-accent)" />
                </ChartCard>

                <ChartCard title="Account Status" subtitle="All voucher records across operators">
                  <DonutChart
                    data={statusBreakdown}
                    centerValue={stats?.totalVoucherRecords || 0}
                    centerLabel="Total"
                  />
                </ChartCard>

                <ChartCard title="Operator Status" subtitle="Active vs inactive client operators">
                  <DonutChart
                    data={charts?.operatorStatus || []}
                    centerValue={stats?.totalOperators || 0}
                    centerLabel="Operators"
                  />
                </ChartCard>

                <div className="stats-grid" style={{ gridColumn: '1 / -1' }}>
                  <StatCard
                    label="Total Operators"
                    value={stats?.totalOperators}
                    meta={`${stats?.activeOperators || 0} active`}
                    icon={Users}
                  />
                  <StatCard
                    label="Accounts Created (lifetime)"
                    value={stats?.totalAccountsCreated}
                    meta="Across all operators"
                    icon={UserCheck}
                  />
                  <StatCard
                    label="Voucher Records"
                    value={stats?.totalVoucherRecords}
                    meta="Total in system"
                    icon={Activity}
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}
