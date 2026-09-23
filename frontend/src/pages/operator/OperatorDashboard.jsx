import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet,
  UserPlus,
  CircleDollarSign,
  PackageCheck,
  Upload,
  Receipt,
  List,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { formatMoney } from '../../utils/money';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ChartCard from '../../components/charts/ChartCard';
import DonutChart from '../../components/charts/DonutChart';
import BarChart from '../../components/charts/BarChart';
import { operatorApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { operatorHasPermission } from '../../constants/operatorPermissions';
import TrialBanner from '../../components/operator/TrialBanner';
import OperatorMarketingAds from '../../components/operator/OperatorMarketingAds';
import { getServiceScopeLabel, getServiceTagLabel } from '../../constants/serviceTags';
import './operator-dashboard.css';

const STATUS_ORDER = ['created', 'pending', 'processing', 'failed'];

function sortStatusBreakdown(items = []) {
  return [...items].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  );
}

function formatShortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  const map = {
    created: 'badge-success',
    pending: 'badge-warning',
    processing: 'badge-info',
    failed: 'badge-danger',
  };
  return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
}

const QUICK_ACTIONS = [
  {
    to: '/operator/create',
    title: 'Create Account',
    desc: 'New customer with subscription',
    icon: UserPlus,
    permission: 'createAccount',
    primary: true,
  },
  {
    to: '/operator/customers?mode=topup',
    title: 'Topup',
    desc: 'Add credit to a customer\'s account',
    icon: CircleDollarSign,
    permission: 'customers',
  },
  {
    to: '/operator/customers?mode=subscribe',
    title: 'Subscribe',
    desc: 'Add package subscription to customer',
    icon: PackageCheck,
    permission: 'customers',
  },
  {
    to: '/operator/wallet',
    title: 'Top Up Wallet',
    desc: 'Add funds to your balance',
    icon: Wallet,
    permission: 'wallet',
  },
  {
    to: '/operator/transactions',
    title: 'Transactions',
    desc: 'View charges and top-ups',
    icon: Receipt,
    permission: 'transactions',
  },
];

function QuickActionLinks({ actions, variant = 'grid' }) {
  const isHero = variant === 'hero';
  return (
    <div className={`operator-dashboard-actions${isHero ? ' is-hero' : ''}`}>
      {actions.map(({ to, title, desc, icon: Icon, primary }) => (
        <Link key={to} to={to} className={`operator-action-card${primary ? ' primary' : ''}`}>
          <div className="operator-action-icon">
            <Icon size={18} />
          </div>
          {isHero ? (
            <>
              <div className="operator-action-text">
                <span className="operator-action-title">{title}</span>
                <span className="operator-action-desc">{desc}</span>
              </div>
              <ChevronRight size={20} className="operator-action-chevron" aria-hidden />
            </>
          ) : (
            <>
              <span className="operator-action-title">{title}</span>
              <span className="operator-action-desc">{desc}</span>
            </>
          )}
        </Link>
      ))}
    </div>
  );
}

export default function OperatorDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [marketingAds, setMarketingAds] = useState(null);

  useEffect(() => {
    operatorApi
      .getStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    operatorApi
      .getMarketingAds()
      .then((items) => setMarketingAds(items || []))
      .catch(() => setMarketingAds([]));
  }, []);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const currencyCode = stats?.currencyCode || 'MVR';
  const charts = stats?.charts;
  const statusBreakdown = sortStatusBreakdown(charts?.statusBreakdown || []);
  const activityTotal = charts?.activityTrend?.reduce((sum, row) => sum + row.count, 0) || 0;

  const spendRows = useMemo(() => {
    const breakdown = stats?.chargeBreakdown;
    if (!breakdown) return [];

    return [
      { key: 'createAccount', label: 'Create Account', ...breakdown.createAccount },
      { key: 'customerTopup', label: 'Customer Topup', ...breakdown.customerTopup },
      { key: 'customerSubscribe', label: 'Customer Subscribe', ...breakdown.customerSubscribe },
      { key: 'bulkCreate', label: 'Bulk Create', ...breakdown.bulkCreate },
    ].filter((row) => row.count > 0 || row.amount > 0);
  }, [stats?.chargeBreakdown]);

  const maxSpend = spendRows.reduce((max, row) => Math.max(max, row.amount), 0);

  const quickActions = useMemo(
    () => QUICK_ACTIONS.filter((action) => operatorHasPermission(user, action.permission)),
    [user]
  );

  const showMarketingHero = marketingAds && marketingAds.length > 0;

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className={`operator-dashboard-welcome${showMarketingHero ? ' is-compact' : ''}`}>
        <div>
          <h1 className="page-title">
            Welcome back
            {user?.clientName || stats?.clientName ? `, ${user?.clientName || stats?.clientName}` : ''}
          </h1>
          <p className="page-subtitle">{today}</p>
          {!showMarketingHero && (
            <div className="operator-dashboard-welcome-meta">
              <span className="badge badge-info">{getServiceScopeLabel(stats?.serviceScope || 'BOTH')}</span>
              {(stats?.packageNames || []).slice(0, 3).map((name) => (
                <span key={name} className="badge badge-neutral">{name}</span>
              ))}
              {(stats?.packageNames?.length || 0) > 3 && (
                <span className="badge badge-neutral">+{(stats.packageNames.length - 3)} more</span>
              )}
            </div>
          )}
        </div>
      </div>

      {!loading && (
        <TrialBanner
          trialActive={stats?.trialActive ?? user?.trialActive}
          trialAccountsRemaining={stats?.trialAccountsRemaining ?? user?.trialAccountsRemaining}
          trialAccountLimit={stats?.trialAccountLimit ?? user?.trialAccountLimit}
          trialAccountsUsed={stats?.trialAccountsUsed ?? user?.trialAccountsUsed}
        />
      )}

      {loading ? (
        <div className="loading-screen" style={{ height: 240 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          {stats?.lowBalance && (
            <div className="operator-alert-banner">
              <AlertTriangle size={18} />
              <span>
                Wallet balance is below your lowest package price ({formatMoney(stats.minPackagePrice, currencyCode)}).{' '}
                {stats?.canSelfTopup !== false ? (
                  <>
                    <Link to="/operator/wallet">Top up your wallet</Link> to continue creating accounts.
                  </>
                ) : (
                  <>Contact Medianet to add wallet funds and continue creating accounts.</>
                )}
              </span>
            </div>
          )}

          {showMarketingHero ? (
            <section className="operator-spotlight" aria-labelledby="operator-spotlight-heading">
              <div className="operator-spotlight-grid">
                <OperatorMarketingAds ads={marketingAds} variant="spotlight" />
                <div className="operator-spotlight-services">
                  <div className="operator-spotlight-services-card">
                    <header className="operator-spotlight-services-header">
                      <h2 id="operator-spotlight-heading" className="operator-spotlight-services-title">
                        Select a service
                      </h2>
                      <p className="operator-spotlight-services-sub">
                        Choose how you&apos;d like to proceed
                      </p>
                      <div className="operator-dashboard-welcome-meta operator-spotlight-meta">
                        <span className="badge badge-info">
                          {getServiceScopeLabel(stats?.serviceScope || 'BOTH')}
                        </span>
                        {(stats?.packageNames || []).slice(0, 2).map((name) => (
                          <span key={name} className="badge badge-neutral">{name}</span>
                        ))}
                      </div>
                    </header>
                    <QuickActionLinks actions={quickActions} variant="hero" />
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <QuickActionLinks actions={quickActions} variant="grid" />
          )}

          <div className="operator-kpi-grid">
            <div className="operator-kpi-wallet">
              <div className="operator-kpi-wallet-label">Available wallet balance</div>
              <div className="operator-kpi-wallet-value">
                {formatMoney(stats?.walletBalance || 0, currencyCode)}
              </div>
              <div className="operator-kpi-wallet-meta">
                {formatMoney(stats?.walletSummary?.totalTopups || 0, currencyCode)} topped up ·{' '}
                {formatMoney(stats?.walletSummary?.totalSpent || 0, currencyCode)} spent (last 30 days)
              </div>
              <div className="operator-kpi-wallet-actions">
                <Link to="/operator/wallet" className="btn btn-sm">Top up wallet</Link>
                <Link to="/operator/transactions" className="btn btn-sm">View transactions</Link>
              </div>
            </div>

            <div className="operator-kpi-card">
              <div className="operator-kpi-card-label">Today</div>
              <div className="operator-kpi-card-value">{stats?.periodCounts?.today || 0}</div>
              <div className="operator-kpi-card-meta">Accounts created today</div>
            </div>

            <div className="operator-kpi-card">
              <div className="operator-kpi-card-label">Last 7 days</div>
              <div className="operator-kpi-card-value">{stats?.periodCounts?.last7Days || 0}</div>
              <div className="operator-kpi-card-meta">Successful accounts</div>
            </div>

            <div className="operator-kpi-card">
              <div className="operator-kpi-card-label">Total created</div>
              <div className="operator-kpi-card-value">{stats?.accountsCreated || 0}</div>
              <div className="operator-kpi-card-meta">All time</div>
            </div>

            <div className="operator-kpi-card">
              <div className="operator-kpi-card-label">Success rate</div>
              <div className="operator-kpi-card-value">
                {stats?.statusCounts?.total
                  ? `${Math.round(((stats.statusCounts.created || 0) / stats.statusCounts.total) * 100)}%`
                  : '—'}
              </div>
              <div className="operator-kpi-card-meta">
                {stats?.statusCounts?.failed || 0} failed · {stats?.statusCounts?.pending || 0} pending
              </div>
            </div>
          </div>

          <div className="dashboard-charts">
            <ChartCard
              title="Account activity"
              subtitle={`Successful accounts per day · last 30 days · ${activityTotal} total`}
              className="chart-card-wide"
            >
              <BarChart data={charts?.activityTrend || []} height={220} />
            </ChartCard>

            <ChartCard
              title="Account status"
              subtitle="Current breakdown of all records"
            >
              <DonutChart
                data={statusBreakdown}
                centerValue={stats?.statusCounts?.total || 0}
                centerLabel="Total"
              />
            </ChartCard>

            <ChartCard
              title="Spending by activity"
              subtitle="Wallet charges in the last 30 days"
            >
              {spendRows.length === 0 ? (
                <div className="chart-empty">No wallet charges in the last 30 days</div>
              ) : (
                <div className="operator-spend-bars">
                  {spendRows.map((row) => (
                    <div key={row.key} className="operator-spend-row">
                      <span className="operator-spend-label">{row.label}</span>
                      <div className="operator-spend-track">
                        <div
                          className="operator-spend-fill"
                          style={{ width: `${maxSpend ? (row.amount / maxSpend) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="operator-spend-amount">
                        {formatMoney(row.amount, currencyCode)} · {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>

          <div className="operator-dashboard-panels">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Your packages</h3>
                <p className="card-subtitle">Products assigned to your account</p>
              </div>
              <div className="card-body operator-panel-list">
                {(stats?.packages || []).length === 0 ? (
                  <div className="empty-state"><p>No packages assigned</p></div>
                ) : (
                  stats.packages.map((pkg) => (
                    <div key={pkg.id} className="operator-panel-item">
                      <div>
                        <div className="operator-panel-item-title">{pkg.name}</div>
                        <div className="operator-panel-item-sub">{getServiceTagLabel(pkg.serviceTag)}</div>
                      </div>
                      <div className="operator-panel-item-value">
                        {formatMoney(pkg.priceAmount, pkg.currencyCode || currencyCode)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="card-title">Recent transactions</h3>
                  <p className="card-subtitle">Latest wallet activity</p>
                </div>
                <Link to="/operator/transactions" className="btn btn-secondary btn-sm">View all</Link>
              </div>
              <div className="card-body operator-panel-list">
                {(stats?.recentTransactions || []).length === 0 ? (
                  <div className="empty-state"><p>No transactions yet</p></div>
                ) : (
                  stats.recentTransactions.map((tx) => (
                    <div key={tx.id} className="operator-panel-item">
                      <div>
                        <div className="operator-panel-item-title">{tx.activity}</div>
                        <div className="operator-panel-item-sub">
                          {formatShortDate(tx.createdAt)}
                          {tx.customerName ? ` · ${tx.customerName}` : ''}
                        </div>
                      </div>
                      <div className={`operator-panel-item-value ${tx.type === 'debit' ? 'debit' : 'credit'}`}>
                        {tx.type === 'debit' ? '−' : '+'}
                        {formatMoney(tx.netAmount, currencyCode)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="card-title">Recent customers</h3>
                  <p className="card-subtitle">Latest customer activity</p>
                </div>
                <Link to="/operator/accounts" className="btn btn-secondary btn-sm">View all</Link>
              </div>
              <div className="card-body operator-panel-list">
                {(stats?.recentAccounts || []).length === 0 ? (
                  <div className="empty-state"><p>No customer history yet</p></div>
                ) : (
                  stats.recentAccounts.map((account) => (
                    <div key={account.id} className="operator-panel-item">
                      <div>
                        <div className="operator-panel-item-title">{account.fullName}</div>
                        <div className="operator-panel-item-sub">
                          {account.phoneNumber}
                          {account.packageNames ? ` · ${account.packageNames}` : ''}
                        </div>
                      </div>
                      <div>
                        <StatusBadge status={account.status} />
                        {account.amountCharged > 0 && (
                          <div className="operator-panel-item-value debit" style={{ marginTop: 6 }}>
                            {formatMoney(account.amountCharged, currencyCode)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">30-day summary</h3>
                <p className="card-subtitle">Key numbers at a glance</p>
              </div>
              <div className="card-body operator-panel-list">
                <div className="operator-panel-item">
                  <div className="operator-panel-item-title">Accounts created</div>
                  <div className="operator-panel-item-value">{stats?.periodCounts?.last30Days || 0}</div>
                </div>
                <div className="operator-panel-item">
                  <div className="operator-panel-item-title">Wallet topped up</div>
                  <div className="operator-panel-item-value credit">
                    +{formatMoney(stats?.walletSummary?.totalTopups || 0, currencyCode)}
                  </div>
                  <div className="operator-panel-item-sub">{stats?.walletSummary?.topupCount || 0} top-up(s)</div>
                </div>
                <div className="operator-panel-item">
                  <div className="operator-panel-item-title">Wallet spent</div>
                  <div className="operator-panel-item-value debit">
                    −{formatMoney(stats?.walletSummary?.totalSpent || 0, currencyCode)}
                  </div>
                  <div className="operator-panel-item-sub">{stats?.walletSummary?.debitCount || 0} charge(s)</div>
                </div>
                <div className="operator-panel-item">
                  <div className="operator-panel-item-title">Assigned packages</div>
                  <div className="operator-panel-item-value">{stats?.packages?.length || 0}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="operator-dashboard-footer">
            <Link to="/operator/bulk"><Upload size={14} /> Bulk upload</Link>
            <Link to="/operator/accounts"><List size={14} /> Customer history</Link>
            <Link to="/operator/reports">Account reports</Link>
          </div>
        </>
      )}
    </Layout>
  );
}
