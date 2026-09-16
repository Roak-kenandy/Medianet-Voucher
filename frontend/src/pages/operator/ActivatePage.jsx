import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, List, UserPlus, Receipt } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import ServiceTypePicker from '../../components/operator/ServiceTypePicker';
import PackagePicker from '../../components/operator/PackagePicker';
import WorkflowSummary, { WorkflowHeaderWallet, WorkflowStep } from '../../components/operator/WorkflowSummary';
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

export default function ActivatePage() {
  const toast = useToast();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packageIds, setPackageIds] = useState([]);
  const [walletBalance, setWalletBalance] = useState(null);
  const [currencyCode, setCurrencyCode] = useState('MVR');
  const [searching, setSearching] = useState(false);
  const [topupId, setTopupId] = useState(null);
  const [error, setError] = useState('');
  const [serviceTag, setServiceTag] = useState('OTT');
  const [serviceScope, setServiceScope] = useState('BOTH');
  const [hasSearched, setHasSearched] = useState(false);
  const [lastTopup, setLastTopup] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((s) => {
      setWalletBalance(s.walletBalance);
      setCurrencyCode(s.currencyCode || 'MVR');
      setPackages(s.packages || []);
      const scope = s.serviceScope || 'BOTH';
      setServiceScope(scope);
      const defaultTag = defaultServiceTag(scope);
      setServiceTag(defaultTag);
      const tagPackages = (s.packages || []).filter(
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
  const canAfford = walletBalance == null || unitCost === 0 || walletBalance >= unitCost;

  const packagesReady =
    taggedPackages.length > 0 &&
    (taggedPackages.length === 1 || activePackageIds.length > 0);

  const handleServiceTagChange = (tag) => {
    const nextPackages = packages.filter((pkg) => (pkg.serviceTag || 'OTT') === tag);
    setServiceTag(tag);
    setPackageIds(nextPackages.length === 1 ? [nextPackages[0].id] : []);
    setHasSearched(false);
    setCustomers([]);
    setLastTopup(null);
    setError('');
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    setCustomers([]);
    setHasSearched(false);
    setLastTopup(null);

    const phoneError = getPhoneValidationMessage(phoneNumber);
    if (phoneError) {
      setError(phoneError);
      return;
    }

    if (!packagesReady) {
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
    if (!packagesReady) {
      toast.error('Select at least one package');
      return;
    }

    if (!canAfford) {
      toast.error(`Insufficient wallet balance. Required ${formatMoney(unitCost, currencyCode)}.`);
      return;
    }

    setTopupId(customer.id);
    setError('');

    try {
      const result = await operatorApi.topupCustomer({
        crmContactId: customer.id,
        fullName: customer.name,
        phoneNumber: customer.phone || sanitizePhoneInput(phoneNumber),
        serviceTag,
        packageIds: activePackageIds.map(Number),
      });

      setWalletBalance(result.walletBalance);
      setLastTopup(result);
      toast.success(`Top-up completed for ${customer.name}`);
      setCustomers((prev) => prev.filter((row) => row.id !== customer.id));
    } catch (err) {
      setError(err.message || 'Top-up failed');
      toast.error(err.message || 'Top-up failed');
    } finally {
      setTopupId(null);
    }
  };

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="workflow-page-header">
        <div>
          <h1 className="page-title">Customer Top-up</h1>
          <p className="page-subtitle">
            Search an existing customer and add a package. Review charges in the order summary before confirming.
          </p>
        </div>
        <WorkflowHeaderWallet balance={walletBalance} currencyCode={currencyCode} />
      </div>

      <div className="workflow-layout">
        <div className="workflow-main">
          {lastTopup && (
            <div className="success-panel" style={{ marginBottom: 20 }}>
              <p className="success-panel-title">Top-up completed</p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastTopup.fullName} · {lastTopup.phoneNumber}
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                <strong>Packages:</strong> {(lastTopup.packageNames || selectedPackages.map((p) => p.name)).join(', ')}
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                <strong>Charged:</strong> {formatMoney(lastTopup.amountCharged, lastTopup.currencyCode || currencyCode)}
                {' · '}
                <strong>Balance:</strong>{' '}
                {formatMoney(lastTopup.balanceBefore, currencyCode)} →{' '}
                {formatMoney(lastTopup.balanceAfter ?? lastTopup.walletBalance, currencyCode)}
              </p>
            </div>
          )}

          <WorkflowStep
            step={1}
            title="Choose product"
            description="Select customer type and the package to add"
          >
            {packages.length > 0 && taggedPackages.length === 0 && (
              <div className="alert alert-info" style={{ marginBottom: 20 }}>
                No {getServiceTagLabel(serviceTag)} packages assigned to your operator account.
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Customer type</label>
              <ServiceTypePicker
                options={serviceTagOptions}
                value={serviceTag}
                onChange={handleServiceTagChange}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                {taggedPackages.length > 1 ? 'Select package(s)' : 'Package'}
              </label>
              <PackagePicker
                packages={taggedPackages}
                selectedIds={activePackageIds}
                onChange={setPackageIds}
                currencyCode={currencyCode}
                disabled={!canAfford && unitCost > 0}
              />
            </div>
          </WorkflowStep>

          <WorkflowStep
            step={2}
            title="Find customer"
            description="Search by phone number to locate the customer"
          >
            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSearch} className="workflow-search-row">
              <div className="form-group">
                <label htmlFor="phoneNumber" className="form-label">Phone number</label>
                <input
                  id="phoneNumber"
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
                  disabled={searching || !packagesReady}
                />
                <p className="form-hint">{PHONE_HINT}</p>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={searching || !packagesReady}
              >
                <Search size={18} />
                {searching ? 'Searching...' : 'Search'}
              </button>
            </form>
          </WorkflowStep>

          {(searching || hasSearched) && (
            <WorkflowStep
              step={3}
              title="Confirm top-up"
              description={
                customers.length
                  ? 'Select a customer and confirm the charge'
                  : 'Review search results'
              }
            >
              {searching ? (
                <div className="loading-screen" style={{ height: 140 }}>
                  <div className="spinner spinner-lg" />
                  <p style={{ marginTop: 12, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                    Searching for customers...
                  </p>
                </div>
              ) : customers.length === 0 ? (
                <div className="workflow-results-empty">
                  <p>
                    No {getServiceTagLabel(serviceTag)} customers found for this phone number.
                  </p>
                  <Link to="/operator/create" className="btn btn-secondary btn-sm">
                    <UserPlus size={14} /> Create new account instead
                  </Link>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Customer name</th>
                        <th>Phone</th>
                        <th>Type</th>
                        <th>Package(s)</th>
                        <th>Charge</th>
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
                              disabled={!canAfford || topupId === customer.id || !packagesReady}
                              onClick={() => handleTopup(customer)}
                            >
                              {topupId === customer.id ? 'Processing...' : 'Top up'}
                            </button>
                          </td>
                        </tr>
                      ))}
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
              selectedPackages={selectedPackages}
              unitCost={unitCost}
              canAfford={canAfford}
              showAction={false}
              footnote="Search for a customer on the left, then click Top up on the matching row. Your wallet is charged immediately."
            />
          </div>
        </aside>
      </div>
    </Layout>
  );
}
