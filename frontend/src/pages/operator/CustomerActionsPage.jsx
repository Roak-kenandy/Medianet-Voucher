import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, List, UserPlus, Receipt, CircleDollarSign, PackageCheck } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ServiceTypePicker from '../../components/operator/ServiceTypePicker';
import PackagePicker from '../../components/operator/PackagePicker';
import WorkflowSummary, {
  WorkflowHeaderWallet,
  WorkflowStep,
  formatResultCharge,
} from '../../components/operator/WorkflowSummary';
import { computeAccountCreationCharge } from '../../utils/trial';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatMoney, sumPackagePrices } from '../../utils/money';
import {
  filterServiceTags,
  defaultServiceTag,
  getServiceTagLabel,
} from '../../constants/serviceTags';
import {
  MALDIVES_PHONE_LENGTH,
  PHONE_HINT,
  sanitizePhoneInput,
  getPhoneValidationMessage,
} from '../../utils/phone';
import { resolveActivePackageIds } from '../../utils/packageSelection';
import './operator-workflow.css';

const MODES = {
  topup: {
    key: 'topup',
    label: 'Topup',
    icon: CircleDollarSign,
    subtitle: 'Add credit to a customer\'s account — no package subscription.',
    summaryFootnote:
      'Adds funds to the customer\'s account. Your wallet is charged for the amount you enter. No package is added.',
  },
  subscribe: {
    key: 'subscribe',
    label: 'Subscribe',
    icon: PackageCheck,
    subtitle: 'Add a package subscription — amount must exactly match the package total.',
    summaryFootnote:
      'Activates the selected package for the customer. The amount must exactly match the package total.',
  },
};

function amountsMatch(expected, provided) {
  return Math.round(Number(expected) * 100) === Math.round(Number(provided) * 100);
}

export default function CustomerActionsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const mode = modeParam === 'subscribe' ? 'subscribe' : 'topup';
  const modeConfig = MODES[mode];

  const [phoneNumber, setPhoneNumber] = useState('');
  const [customers, setCustomers] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [packages, setPackages] = useState([]);
  const [packageIds, setPackageIds] = useState([]);
  const [amountInput, setAmountInput] = useState('');
  const [walletBalance, setWalletBalance] = useState(null);
  const [trialAccountsRemaining, setTrialAccountsRemaining] = useState(0);
  const [currencyCode, setCurrencyCode] = useState('MVR');
  const [searching, setSearching] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState('');
  const [serviceTag, setServiceTag] = useState('OTT');
  const [serviceScope, setServiceScope] = useState('BOTH');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((stats) => {
      setWalletBalance(stats.walletBalance);
      setTrialAccountsRemaining(stats.trialAccountsRemaining || 0);
      setCurrencyCode(stats.currencyCode || 'MVR');
      setPackages(stats.packages || []);
      const scope = stats.serviceScope || 'BOTH';
      setServiceScope(scope);
      const defaultTag = defaultServiceTag(scope);
      setServiceTag(defaultTag);
      const tagPackages = (stats.packages || []).filter(
        (pkg) => (pkg.serviceTag || 'OTT') === defaultTag
      );
      if (tagPackages.length === 1) {
        setPackageIds([tagPackages[0].id]);
      }
    });
  }, []);

  const serviceTagOptions = filterServiceTags(serviceScope);

  const taggedPackages = useMemo(
    () => packages.filter((pkg) => (pkg.serviceTag || 'OTT') === serviceTag),
    [packages, serviceTag]
  );

  const activePackageIds = resolveActivePackageIds(packageIds, taggedPackages);
  const selectedPackages = taggedPackages.filter((pkg) =>
    activePackageIds.map(Number).includes(Number(pkg.id))
  );

  const unitCost = sumPackagePrices(taggedPackages, activePackageIds);
  const subscribeChargePreview = computeAccountCreationCharge(unitCost, 1, trialAccountsRemaining);
  const canAffordSubscribe =
    walletBalance == null ||
    unitCost === 0 ||
    subscribeChargePreview.usesTrial ||
    walletBalance >= subscribeChargePreview.effectiveCharge;
  const packagesReady =
    taggedPackages.length > 0 &&
    (taggedPackages.length === 1 || activePackageIds.length > 0);
  const amountValid = unitCost > 0 && amountsMatch(unitCost, amountInput);
  const isSubscribe = mode === 'subscribe';
  const searchReady = isSubscribe ? packagesReady : true;

  useEffect(() => {
    if (unitCost > 0) {
      setAmountInput(String(unitCost));
    } else {
      setAmountInput('');
    }
  }, [unitCost]);

  const resetSearchState = () => {
    setHasSearched(false);
    setCustomers([]);
    setAmounts({});
    setLastResult(null);
    setError('');
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setSearchParams({ mode: nextMode }, { replace: true });
    resetSearchState();
  };

  const handleServiceTagChange = (tag) => {
    const nextPackages = packages.filter((pkg) => (pkg.serviceTag || 'OTT') === tag);
    setServiceTag(tag);
    setPackageIds(nextPackages.length === 1 ? [nextPackages[0].id] : []);
    resetSearchState();
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    setCustomers([]);
    setAmounts({});
    setHasSearched(false);
    setLastResult(null);

    const phoneError = getPhoneValidationMessage(phoneNumber);
    if (phoneError) {
      setError(phoneError);
      return;
    }

    if (isSubscribe && !packagesReady) {
      setError('Select at least one package before searching');
      return;
    }

    setSearching(true);

    try {
      const result = await operatorApi.searchCustomers(
        sanitizePhoneInput(phoneNumber),
        serviceTag
      );
      setCustomers(result.customers || []);
      setHasSearched(true);
      if (!result.customers?.length) {
        toast.info(`No ${getServiceTagLabel(serviceTag)} customers found for this phone number`);
      }
    } catch (err) {
      setHasSearched(true);
      setError(err.message || 'Customer search failed');
      toast.error(err.message || 'Customer search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleTopup = async (customer) => {
    const amount = Math.round(Number(amounts[customer.id]) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid top-up amount');
      return;
    }

    if (walletBalance != null && walletBalance < amount) {
      toast.error(`Insufficient wallet balance. Required ${formatMoney(amount, currencyCode)}.`);
      return;
    }

    setProcessingId(customer.id);
    setError('');

    try {
      const result = await operatorApi.crmTopupCustomer({
        crmContactId: customer.id,
        fullName: customer.name,
        phoneNumber: customer.phone || sanitizePhoneInput(phoneNumber),
        serviceTag,
        amount,
      });

      setWalletBalance(result.walletBalance);
      setLastResult({ type: 'topup', ...result });
      toast.success(`Top-up completed for ${customer.name}`);
      setCustomers((prev) => prev.filter((row) => row.id !== customer.id));
    } catch (err) {
      setError(err.message || 'Top-up failed');
      toast.error(err.message || 'Top-up failed');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSubscribe = async (customer) => {
    if (!packagesReady) {
      toast.error('Select at least one package');
      return;
    }

    if (!amountValid) {
      toast.error(`Amount must exactly match ${formatMoney(unitCost, currencyCode)}`);
      return;
    }

    if (!canAffordSubscribe) {
      toast.error(
        `Insufficient wallet balance. Required ${formatMoney(subscribeChargePreview.effectiveCharge, currencyCode)}.`
      );
      return;
    }

    setProcessingId(customer.id);
    setError('');

    try {
      const result = await operatorApi.subscribeCustomer({
        crmContactId: customer.id,
        fullName: customer.name,
        phoneNumber: customer.phone || sanitizePhoneInput(phoneNumber),
        serviceTag,
        packageIds: activePackageIds.map(Number),
        amount: Number(amountInput),
      });

      setWalletBalance(result.walletBalance);
      if (!result.amountCharged) {
        setTrialAccountsRemaining((prev) => Math.max(0, prev - 1));
      }
      setLastResult({ type: 'subscribe', ...result });
      toast.success(`Subscription created for ${customer.name}`);
      setCustomers((prev) => prev.filter((row) => row.id !== customer.id));
    } catch (err) {
      setError(err.message || 'Subscribe failed');
      toast.error(err.message || 'Subscribe failed');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="workflow-page-header">
        <div>
          <h1 className="page-title">Topup & Subscribe</h1>
          <p className="page-subtitle">{modeConfig.subtitle}</p>
        </div>
        <WorkflowHeaderWallet balance={walletBalance} currencyCode={currencyCode} />
      </div>

      <div className="workflow-mode-tabs" role="tablist" aria-label="Customer action type">
        {Object.values(MODES).map((item) => {
          const Icon = item.icon;
          const isActive = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`workflow-mode-tab${isActive ? ' active' : ''}`}
              onClick={() => switchMode(item.key)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="workflow-layout">
        <div className="workflow-main">
          {lastResult && (
            <div className="success-panel" style={{ marginBottom: 20 }}>
              <p className="success-panel-title">
                {lastResult.type === 'subscribe' ? 'Subscription completed' : 'Top-up completed'}
              </p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastResult.fullName} · {lastResult.phoneNumber}
              </p>
              {lastResult.type === 'subscribe' && (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  <strong>Packages:</strong>{' '}
                  {(lastResult.packageNames || selectedPackages.map((p) => p.name)).join(', ')}
                </p>
              )}
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                <strong>Amount:</strong>{' '}
                {formatResultCharge(lastResult.amountCharged, lastResult.currencyCode || currencyCode)}
                {' · '}
                <strong>Balance:</strong>{' '}
                {formatMoney(lastResult.balanceBefore, currencyCode)} →{' '}
                {formatMoney(lastResult.balanceAfter ?? lastResult.walletBalance, currencyCode)}
              </p>
            </div>
          )}

          <WorkflowStep
            step={1}
            title="Customer type"
            description="Choose Mobile or TV"
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <ServiceTypePicker
                options={serviceTagOptions}
                value={serviceTag}
                onChange={handleServiceTagChange}
              />
            </div>
          </WorkflowStep>

          {isSubscribe && (
            <WorkflowStep
              step={2}
              title="Choose package"
              description="Select package(s) and confirm the exact amount"
            >
              {packages.length > 0 && taggedPackages.length === 0 && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                  No {getServiceTagLabel(serviceTag)} packages assigned to your operator account.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">
                  {taggedPackages.length > 1 ? 'Select package(s)' : 'Package'}
                </label>
                <PackagePicker
                  packages={taggedPackages}
                  selectedIds={activePackageIds}
                  onChange={setPackageIds}
                  currencyCode={currencyCode}
                  disabled={!canAffordSubscribe && unitCost > 0}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="subscribeAmount" className="form-label">
                  Amount (must match package total)
                </label>
                <input
                  id="subscribeAmount"
                  type="number"
                  className={`form-input${amountInput && !amountValid ? ' error' : ''}`}
                  min="0"
                  step="any"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  disabled={!packagesReady}
                />
                <p className="form-hint">
                  {packagesReady
                    ? `Required amount: ${formatMoney(unitCost, currencyCode)}`
                    : 'Select a package to see the required amount'}
                </p>
              </div>
            </WorkflowStep>
          )}

          {!isSubscribe && (
            <div className="alert alert-info" style={{ marginBottom: 20 }}>
              Enter any amount after you find the customer. This adds credit to their account only — no package subscription.
            </div>
          )}

          <WorkflowStep
            step={isSubscribe ? 3 : 2}
            title="Find customer"
            description="Search by phone number"
          >
            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSearch} className="workflow-search-row">
              <div className="form-group">
                <label htmlFor="customerPhoneNumber" className="form-label">Phone number</label>
                <input
                  id="customerPhoneNumber"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className="form-input"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(sanitizePhoneInput(e.target.value))}
                  placeholder="9XXXXXX"
                  required
                  minLength={MALDIVES_PHONE_LENGTH}
                  maxLength={MALDIVES_PHONE_LENGTH}
                  pattern="[79][0-9]{6}"
                  disabled={searching || !searchReady}
                />
                <p className="form-hint">{PHONE_HINT}</p>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={searching || !searchReady}
              >
                <Search size={18} />
                {searching ? 'Searching...' : 'Search'}
              </button>
            </form>
          </WorkflowStep>

          {(searching || hasSearched) && (
            <WorkflowStep
              step={isSubscribe ? 4 : 3}
              title={isSubscribe ? 'Confirm subscribe' : 'Add credit'}
              description={
                isSubscribe
                  ? 'Activate the package for the selected customer'
                  : 'Enter the amount and confirm the top-up'
              }
            >
              {searching ? (
                <div className="loading-screen" style={{ height: 140 }}>
                  <div className="spinner spinner-lg" />
                </div>
              ) : customers.length === 0 ? (
                <div className="workflow-results-empty">
                  <p>No {getServiceTagLabel(serviceTag)} customers found for this phone number.</p>
                  <Link to="/operator/create" className="btn btn-secondary btn-sm">
                    <UserPlus size={14} /> Create new account instead
                  </Link>
                </div>
              ) : isSubscribe ? (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Customer name</th>
                        <th>Phone</th>
                        <th>Type</th>
                        <th>Package(s)</th>
                        <th>Amount</th>
                        <th style={{ width: 140 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr key={customer.id}>
                          <td style={{ fontWeight: 500 }}>{customer.name}</td>
                          <td>{customer.phone}</td>
                          <td>
                            <span className="badge badge-info">
                              {customer.serviceTypeShort ||
                                (customer.serviceTag === 'MEDIANET_TV' ? 'TV' : 'Mobile')}
                            </span>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                            {selectedPackages.map((p) => p.name).join(', ') || '—'}
                          </td>
                          <td style={{ fontWeight: 600 }}>{formatMoney(unitCost, currencyCode)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={
                                !canAffordSubscribe ||
                                !amountValid ||
                                processingId === customer.id ||
                                !packagesReady
                              }
                              onClick={() => handleSubscribe(customer)}
                            >
                              {processingId === customer.id ? 'Processing...' : 'Subscribe'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Customer name</th>
                        <th>Phone</th>
                        <th>Type</th>
                        <th style={{ width: 160 }}>Top-up amount</th>
                        <th style={{ width: 120 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => {
                        const amount = amounts[customer.id] ?? '';
                        const parsedAmount = Number(amount);
                        const canSubmit =
                          Number.isFinite(parsedAmount) &&
                          parsedAmount > 0 &&
                          (walletBalance == null || walletBalance >= parsedAmount);

                        return (
                          <tr key={customer.id}>
                            <td style={{ fontWeight: 500 }}>{customer.name}</td>
                            <td>{customer.phone}</td>
                            <td>
                              <span className="badge badge-info">
                                {customer.serviceTypeShort ||
                                  (customer.serviceTag === 'MEDIANET_TV' ? 'TV' : 'Mobile')}
                              </span>
                            </td>
                            <td>
                              <input
                                type="number"
                                className="form-input"
                                min="1"
                                step="any"
                                placeholder="Amount"
                                value={amount}
                                onChange={(e) =>
                                  setAmounts((prev) => ({ ...prev, [customer.id]: e.target.value }))
                                }
                                disabled={processingId === customer.id}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={!canSubmit || processingId === customer.id}
                                onClick={() => handleTopup(customer)}
                              >
                                {processingId === customer.id ? 'Processing...' : 'Top up'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </WorkflowStep>
          )}

          <div className="workflow-footer-links">
            <Link to="/operator/create"><UserPlus size={14} /> Create new account</Link>
            <Link to="/operator/accounts"><List size={14} /> View all accounts</Link>
            <Link to="/operator/transactions"><Receipt size={14} /> Transaction reports</Link>
          </div>
        </div>

        <aside className="workflow-sidebar">
          <div className="workflow-sidebar-inner">
            <WorkflowSummary
              walletBalance={walletBalance}
              currencyCode={currencyCode}
              selectedPackages={isSubscribe ? selectedPackages : []}
              unitCost={isSubscribe ? unitCost : 0}
              chargeAmount={isSubscribe ? subscribeChargePreview.effectiveCharge : 0}
              trialFreeCount={isSubscribe ? subscribeChargePreview.freeCount : 0}
              canAfford={isSubscribe ? canAffordSubscribe && amountValid : true}
              showAction={false}
              footnote={
                isSubscribe && subscribeChargePreview.usesTrial
                  ? 'This subscription uses a free trial slot. Your wallet will not be charged.'
                  : modeConfig.summaryFootnote
              }
            />
          </div>
        </aside>
      </div>
    </Layout>
  );
}
