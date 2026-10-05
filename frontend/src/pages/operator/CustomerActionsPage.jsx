import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, List, UserPlus, Receipt, CircleDollarSign, PackageCheck } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ServiceTypePicker from '../../components/operator/ServiceTypePicker';
import PackageOptions from '../../components/operator/PackageOptions';
import CustomerCard, { AccountBalance, ServiceList } from '../../components/operator/CustomerCard';
import WorkflowSummary, {
  WorkflowHeaderStats,
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
import './operator-workflow.css';

const MODES = {
  topup: {
    key: 'topup',
    label: 'Topup',
    icon: CircleDollarSign,
    subtitle: 'Find a customer, check their account balance, then add credit. No package is added.',
    summaryFootnote:
      'Adds funds to the customer\'s account. Your wallet is charged for the amount you enter. No package is added.',
  },
  subscribe: {
    key: 'subscribe',
    label: 'Subscribe',
    icon: PackageCheck,
    subtitle: 'Find a customer, check their current services and due dates, then continue, upgrade or add a package.',
    summaryFootnote:
      'Only packages this customer is eligible for are offered. Your wallet is charged the package price.',
  },
};

const QUICK_TOPUP_AMOUNTS = [50, 100, 200, 500];

const PURCHASE_LABELS = {
  subscribe: { button: 'Subscribe', verb: 'Add', done: 'Subscription completed', toast: 'Subscription created' },
  renew: { button: 'Renew', verb: 'Continue', done: 'Renewal completed', toast: 'Package renewed' },
  upgrade: { button: 'Upgrade', verb: 'Upgrade to', done: 'Upgrade completed', toast: 'Package upgraded' },
};

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
  // The purchase being prepared: { customerId, action, packageIds }. One customer at a time.
  const [selection, setSelection] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [trialAccountLimit, setTrialAccountLimit] = useState(0);
  const [trialAccountsUsed, setTrialAccountsUsed] = useState(0);
  const [trialAccountsRemaining, setTrialAccountsRemaining] = useState(0);
  const [currencyCode, setCurrencyCode] = useState('MVR');
  const [searching, setSearching] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState('');
  const [serviceTag, setServiceTag] = useState('OTT');
  // 'phone' or 'code' (the service code on the customer's device)
  const [searchBy, setSearchBy] = useState('phone');
  const [serviceCode, setServiceCode] = useState('');
  // What the current results were found with; sent along when charging so the server re-checks it.
  const [searchedCode, setSearchedCode] = useState('');
  const [serviceScope, setServiceScope] = useState('BOTH');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((stats) => {
      setWalletBalance(stats.walletBalance);
      setTrialAccountLimit(stats.trialAccountLimit || 0);
      setTrialAccountsUsed(stats.trialAccountsUsed || 0);
      setTrialAccountsRemaining(stats.trialAccountsRemaining || 0);
      setCurrencyCode(stats.currencyCode || 'MVR');
      setPackages(stats.packages || []);
      const scope = stats.serviceScope || 'BOTH';
      setServiceScope(scope);
      const defaultTag = defaultServiceTag(scope);
      setServiceTag(defaultTag);
    });
  }, []);

  const serviceTagOptions = filterServiceTags(serviceScope);

  const taggedPackages = useMemo(
    () => packages.filter((pkg) => (pkg.serviceTag || 'OTT') === serviceTag),
    [packages, serviceTag]
  );

  const activePackageIds = selection?.packageIds || [];
  const selectedPackages = taggedPackages.filter((pkg) => activePackageIds.includes(Number(pkg.id)));
  const purchaseLabels = PURCHASE_LABELS[selection?.action] || PURCHASE_LABELS.subscribe;

  // An upgrade is priced by CRM (new package less credit for unused days), not by list price.
  const upgradeCharge =
    selection?.action === 'upgrade'
      ? customers
          .find((row) => row.key === selection.customerId)
          ?.packageOptions?.find((option) => option.packageId === activePackageIds[0])?.charge
      : null;
  const unitCost = upgradeCharge ? upgradeCharge.amount : sumPackagePrices(taggedPackages, activePackageIds);
  // Free-account slots only apply to new packages; renewals and upgrades are always paid.
  const subscribeChargePreview = computeAccountCreationCharge(
    unitCost,
    1,
    selection?.action === 'subscribe' ? trialAccountsRemaining : 0
  );
  const canAffordSubscribe =
    walletBalance == null ||
    subscribeChargePreview.effectiveCharge === 0 ||
    subscribeChargePreview.usesTrial ||
    walletBalance >= subscribeChargePreview.effectiveCharge;
  const isSubscribe = mode === 'subscribe';

  const resetSearchState = () => {
    setHasSearched(false);
    setCustomers([]);
    setAmounts({});
    setSelection(null);
    setLastResult(null);
    setError('');
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setSearchParams({ mode: nextMode }, { replace: true });
    resetSearchState();
  };

  const handleServiceTagChange = (tag) => {
    setServiceTag(tag);
    resetSearchState();
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    setCustomers([]);
    setAmounts({});
    setSelection(null);
    setHasSearched(false);
    setLastResult(null);

    const byCode = searchBy === 'code';
    const code = serviceCode.trim();
    if (byCode) {
      if (!/^[A-Za-z0-9-]{3,32}$/.test(code)) {
        setError('Enter a valid service code');
        return;
      }
    } else {
      const phoneError = getPhoneValidationMessage(phoneNumber);
      if (phoneError) {
        setError(phoneError);
        return;
      }
    }

    setSearching(true);

    try {
      const result = await operatorApi.searchCustomers(
        byCode ? { code } : { phone: sanitizePhoneInput(phoneNumber) },
        serviceTag
      );
      setSearchedCode(byCode ? code : '');
      setCustomers(result.customers || []);
      setHasSearched(true);
      if (!result.customers?.length) {
        toast.info(
          `No ${getServiceTagLabel(serviceTag)} customers found for this ${byCode ? 'service code' : 'phone number'}`
        );
      }
    } catch (err) {
      setHasSearched(true);
      setError(err.message || 'Customer search failed');
      toast.error(err.message || 'Customer search failed');
    } finally {
      setSearching(false);
    }
  };

  /** Identifies the customer to the server the same way they were found: by service code or by phone. */
  const customerLookupKey = (customer) =>
    searchedCode
      ? { serviceCode: searchedCode }
      : { phoneNumber: String(customer.phone || '').replace(/\D/g, '').slice(-7) || sanitizePhoneInput(phoneNumber) };

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
        ...customerLookupKey(customer),
        serviceTag,
        amount,
      });

      setWalletBalance(result.walletBalance);
      setLastResult({ type: 'topup', ...result });
      toast.success(`Top-up completed for ${customer.name}`);
      // Keep the customer on screen with the new balance so another top-up can follow.
      setCustomers((prev) =>
        prev.map((row) => {
          if (row.id !== customer.id || !row.account) return row;
          const balance = Math.round((row.account.balance - amount) * 100) / 100;
          return {
            ...row,
            account: {
              ...row.account,
              balance,
              creditAmount: balance < 0 ? Math.abs(balance) : 0,
              dueAmount: balance > 0 ? balance : 0,
            },
          };
        })
      );
      setAmounts((prev) => ({ ...prev, [customer.id]: '' }));
    } catch (err) {
      setError(err.message || 'Top-up failed');
      toast.error(err.message || 'Top-up failed');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSubscribe = async (customer) => {
    if (selection?.customerId !== customer.key || !activePackageIds.length) {
      toast.error('Select a package for this customer');
      return;
    }

    if (!canAffordSubscribe) {
      toast.error(
        `Insufficient wallet balance. Required ${formatMoney(subscribeChargePreview.effectiveCharge, currencyCode)}.`
      );
      return;
    }

    setProcessingId(customer.key);
    setError('');

    try {
      const lookupKey = customerLookupKey(customer);
      const result = await operatorApi.subscribeCustomer({
        crmContactId: customer.id,
        fullName: customer.name,
        ...lookupKey,
        ...(customer.deviceId ? { deviceId: customer.deviceId } : {}),
        serviceTag,
        packageIds: activePackageIds,
        amount: unitCost,
      });

      setWalletBalance(result.walletBalance);
      if (result.action === 'subscribe' && !result.amountCharged) {
        setTrialAccountsRemaining((prev) => Math.max(0, prev - 1));
        setTrialAccountsUsed((prev) => prev + 1);
      }
      setLastResult({ type: 'subscribe', ...result });
      toast.success(`${(PURCHASE_LABELS[result.action] || PURCHASE_LABELS.subscribe).toast} for ${customer.name}`);
      setSelection(null);

      // Reload the customer so their services and what they can buy next are up to date.
      try {
        const refreshed = await operatorApi.searchCustomers(
          lookupKey.serviceCode ? { code: lookupKey.serviceCode } : { phone: lookupKey.phoneNumber },
          serviceTag
        );
        const fresh = (refreshed.customers || []).find((row) => row.key === customer.key);
        setCustomers((prev) =>
          fresh ? prev.map((row) => (row.key === customer.key ? fresh : row)) : prev.filter((row) => row.key !== customer.key)
        );
      } catch {
        setCustomers((prev) => prev.filter((row) => row.key !== customer.key));
      }
    } catch (err) {
      setError(err.message || `${purchaseLabels.button} failed`);
      toast.error(err.message || `${purchaseLabels.button} failed`);
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
        <WorkflowHeaderStats
          balance={walletBalance}
          currencyCode={currencyCode}
          trialAccountLimit={isSubscribe ? trialAccountLimit : 0}
          trialAccountsUsed={isSubscribe ? trialAccountsUsed : 0}
          trialAccountsRemaining={isSubscribe ? trialAccountsRemaining : 0}
        />
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
                {lastResult.type === 'subscribe'
                  ? (PURCHASE_LABELS[lastResult.action] || PURCHASE_LABELS.subscribe).done
                  : 'Top-up completed'}
              </p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastResult.fullName} · {lastResult.phoneNumber}
              </p>
              {lastResult.type === 'subscribe' && (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  <strong>Packages:</strong>{' '}
                  {(lastResult.packageNames || []).join(', ')}
                  {lastResult.replacedPackage ? ` (replaced ${lastResult.replacedPackage})` : ''}
                  {lastResult.creditApplied > 0
                    ? ` · ${formatMoney(lastResult.creditApplied, currencyCode)} credit for unused days applied`
                    : ''}
                  {lastResult.cancelledAddons?.length
                    ? ` · Cancelled add-on: ${lastResult.cancelledAddons.join(', ')}`
                    : ''}
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
            description="Choose the kind of customer you are looking for"
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <ServiceTypePicker
                options={serviceTagOptions}
                value={serviceTag}
                onChange={handleServiceTagChange}
              />
            </div>
          </WorkflowStep>

          <WorkflowStep
            step={2}
            title="Find customer"
            description="Search by phone number or service code"
          >
            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSearch} className="workflow-search-row">
              <div className="form-group">
                <label className="form-label">Search by</label>
                <div className="scope-selector">
                  {[
                    { key: 'phone', label: 'Phone number' },
                    { key: 'code', label: 'Service code' },
                  ].map((option) => (
                    <label
                      key={option.key}
                      className={`scope-selector-item${searchBy === option.key ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="customerSearchBy"
                        checked={searchBy === option.key}
                        onChange={() => {
                          setSearchBy(option.key);
                          setCustomers([]);
                          setHasSearched(false);
                          setError('');
                        }}
                        disabled={searching}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {searchBy === 'code' ? (
                <div className="form-group">
                  <label htmlFor="customerServiceCode" className="form-label">Service code</label>
                  <input
                    id="customerServiceCode"
                    className="form-input"
                    value={serviceCode}
                    onChange={(e) => setServiceCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 32))}
                    placeholder="e.g. 123456"
                    required
                    minLength={3}
                    maxLength={32}
                    disabled={searching}
                  />
                  <p className="form-hint">The code shown on the customer's device or account.</p>
                </div>
              ) : (
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
                    disabled={searching}
                  />
                  <p className="form-hint">{PHONE_HINT}</p>
                </div>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={searching}
              >
                <Search size={18} />
                {searching ? 'Searching...' : 'Search'}
              </button>
            </form>
          </WorkflowStep>


          {(searching || hasSearched) && (
            <WorkflowStep
              step={3}
              title={isSubscribe ? 'Customer, current services and packages' : 'Customer and account balance'}
              description={
                isSubscribe
                  ? 'Check what the customer has, then continue it, upgrade it or add a package'
                  : 'Check the balance, then enter the amount to add'
              }
            >
              {searching ? (
                <div className="loading-screen" style={{ height: 140 }}>
                  <div className="spinner spinner-lg" />
                </div>
              ) : customers.length === 0 ? (
                <div className="workflow-results-empty">
                  <p>
                    No {getServiceTagLabel(serviceTag)} customers found for this{' '}
                    {searchedCode ? 'service code' : 'phone number'}.
                  </p>
                  <Link to="/operator/create" className="btn btn-secondary btn-sm">
                    <UserPlus size={14} /> Create new account instead
                  </Link>
                </div>
              ) : isSubscribe ? (
                customers.map((customer) => {
                  const mine = selection?.customerId === customer.key ? selection : null;
                  const busy = processingId === customer.key;
                  return (
                    <CustomerCard key={customer.key} customer={customer}>
                      <h5 className="customer-card-section-title">
                        {customer.deviceCode ? `Services on device ${customer.deviceCode}` : 'Current services'}
                      </h5>
                      {customer.deviceCount > 1 && (
                        <p className="form-hint" style={{ marginTop: 0 }}>
                          This customer has {customer.deviceCount} devices. Packages bought here go to this device only.
                        </p>
                      )}
                      <ServiceList services={customer.services} />

                      <h5 className="customer-card-section-title" style={{ marginTop: 20 }}>
                        What this customer can buy
                      </h5>
                      {packages.length > 0 && taggedPackages.length === 0 ? (
                        <div className="alert alert-info">
                          No {getServiceTagLabel(serviceTag)} packages assigned to your operator account.
                        </div>
                      ) : (
                        <PackageOptions
                          options={customer.packageOptions}
                          packages={taggedPackages}
                          currencyCode={currencyCode}
                          selection={mine}
                          disabled={processingId != null}
                          onSelect={(next) => setSelection(next ? { customerId: customer.key, ...next } : null)}
                        />
                      )}

                      {mine && (
                        <div className="customer-confirm-row" style={{ marginTop: 16 }}>
                          <div>
                            <strong>
                              {purchaseLabels.verb} {selectedPackages.map((p) => p.name).join(', ')}
                            </strong>
                            <div className="customer-card-contact">
                              {subscribeChargePreview.usesTrial
                                ? 'Uses a free account slot. Your wallet is not charged.'
                                : canAffordSubscribe
                                  ? `${formatMoney(subscribeChargePreview.effectiveCharge, currencyCode)} will be taken from your wallet`
                                  : `Your wallet has ${formatMoney(walletBalance, currencyCode)}, which is less than ${formatMoney(subscribeChargePreview.effectiveCharge, currencyCode)}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!canAffordSubscribe || busy}
                            onClick={() => handleSubscribe(customer)}
                          >
                            {busy ? 'Processing...' : purchaseLabels.button}
                          </button>
                        </div>
                      )}
                    </CustomerCard>
                  );
                })
              ) : (
                // The balance belongs to the customer's account, so show each customer once.
                customers.filter((row, index) => customers.findIndex((other) => other.id === row.id) === index).map((customer) => {
                  const amount = amounts[customer.id] ?? '';
                  const parsedAmount = Number(amount);
                  const hasAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
                  const walletShort = hasAmount && walletBalance != null && walletBalance < parsedAmount;
                  const busy = processingId === customer.id;
                  // CRM balance: negative is credit. A top-up moves it further into credit.
                  const balanceAfter = customer.account && hasAmount ? customer.account.balance - parsedAmount : null;

                  return (
                    <CustomerCard key={customer.id} customer={customer}>
                      <div className="customer-card-columns">
                        <AccountBalance account={customer.account} />
                        <div className="customer-topup-form">
                          <label className="form-label" htmlFor={`topup-amount-${customer.id}`}>
                            Top-up amount ({currencyCode})
                          </label>
                          <div className="customer-topup-row">
                            <input
                              id={`topup-amount-${customer.id}`}
                              type="number"
                              className="form-input"
                              min="1"
                              step="any"
                              placeholder="Amount"
                              value={amount}
                              onChange={(e) =>
                                setAmounts((prev) => ({ ...prev, [customer.id]: e.target.value }))
                              }
                              disabled={busy}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={!hasAmount || walletShort || busy}
                              onClick={() => handleTopup(customer)}
                            >
                              {busy ? 'Processing...' : 'Top up'}
                            </button>
                          </div>
                          <div className="customer-topup-quick">
                            {QUICK_TOPUP_AMOUNTS.map((quick) => (
                              <button
                                key={quick}
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busy}
                                onClick={() => setAmounts((prev) => ({ ...prev, [customer.id]: String(quick) }))}
                              >
                                {formatMoney(quick, currencyCode)}
                              </button>
                            ))}
                          </div>
                          {walletShort ? (
                            <p className="customer-topup-preview" style={{ color: 'var(--color-danger-text)' }}>
                              Your wallet has {formatMoney(walletBalance, currencyCode)}, which is less than this amount.
                            </p>
                          ) : balanceAfter != null ? (
                            <p className="customer-topup-preview">
                              After this top-up the customer will have{' '}
                              <strong>
                                {balanceAfter <= 0
                                  ? `${formatMoney(Math.abs(balanceAfter), currencyCode)} credit`
                                  : `${formatMoney(balanceAfter, currencyCode)} still due`}
                              </strong>
                              .
                            </p>
                          ) : (
                            <p className="customer-topup-preview">
                              The amount is taken from your wallet and added to the customer's account.
                            </p>
                          )}
                        </div>
                      </div>
                    </CustomerCard>
                  );
                })
              )}
            </WorkflowStep>
          )}

          <div className="workflow-footer-links">
            <Link to="/operator/create"><UserPlus size={14} /> Create new account</Link>
            <Link to="/operator/accounts"><List size={14} /> View customer history</Link>
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
              canAfford={isSubscribe ? canAffordSubscribe : true}
              showAction={false}
              footnote={
                isSubscribe && subscribeChargePreview.usesTrial
                  ? 'This subscription uses a free account slot. Your wallet will not be charged.'
                  : modeConfig.summaryFootnote
              }
            />
          </div>
        </aside>
      </div>
    </Layout>
  );
}
