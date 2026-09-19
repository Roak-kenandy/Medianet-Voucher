import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, List, Receipt } from 'lucide-react';
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
import { formatMoney, sumPackagePrices } from '../../utils/money';
import { resolveActivePackageIds } from '../../utils/packageSelection';
import './operator-workflow.css';

export default function CreateAccountPage() {
  const toast = useToast();
  const formRef = useRef(null);
  const [packages, setPackages] = useState([]);
  const [serviceTags, setServiceTags] = useState([]);
  const [walletBalance, setWalletBalance] = useState(null);
  const [trialAccountsRemaining, setTrialAccountsRemaining] = useState(0);
  const [currencyCode, setCurrencyCode] = useState('MVR');
  const [packageIds, setPackageIds] = useState([]);
  const [form, setForm] = useState({ fullName: '', phoneNumber: '', serviceTag: 'OTT' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((stats) => {
      const tags = filterServiceTags(stats.serviceScope || 'BOTH');
      setServiceTags(tags);
      setPackages(stats.packages || []);
      setWalletBalance(stats.walletBalance);
      setTrialAccountsRemaining(stats.trialAccountsRemaining || 0);
      setCurrencyCode(stats.currencyCode || 'MVR');
      const defaultTag = defaultServiceTag(stats.serviceScope);
      setForm((prev) => ({ ...prev, serviceTag: defaultTag }));
      const tagPackages = (stats.packages || []).filter(
        (pkg) => (pkg.serviceTag || 'OTT') === defaultTag
      );
      if (tagPackages.length === 1) {
        setPackageIds([tagPackages[0].id]);
      }
    });
  }, []);

  const taggedPackages = useMemo(
    () => packages.filter((pkg) => (pkg.serviceTag || 'OTT') === form.serviceTag),
    [packages, form.serviceTag]
  );

  const activePackageIds = resolveActivePackageIds(packageIds, taggedPackages);
  const selectedPackages = taggedPackages.filter((pkg) =>
    activePackageIds.map(Number).includes(Number(pkg.id))
  );

  const unitCost = sumPackagePrices(taggedPackages, activePackageIds);
  const chargePreview = computeAccountCreationCharge(unitCost, 1, trialAccountsRemaining);
  const canAfford =
    walletBalance == null ||
    unitCost === 0 ||
    chargePreview.usesTrial ||
    walletBalance >= chargePreview.effectiveCharge;

  const formReady =
    taggedPackages.length > 0 &&
    (taggedPackages.length === 1 || activePackageIds.length > 0) &&
    canAfford;

  const handleServiceTagChange = (serviceTag) => {
    const nextPackages = packages.filter((pkg) => (pkg.serviceTag || 'OTT') === serviceTag);
    setForm((prev) => ({ ...prev, serviceTag }));
    setPackageIds(nextPackages.length === 1 ? [nextPackages[0].id] : []);
    setLastResult(null);
    setError('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLastResult(null);

    const phoneError = getPhoneValidationMessage(form.phoneNumber);
    if (phoneError) {
      setError(phoneError);
      return;
    }

    if (taggedPackages.length > 1 && !activePackageIds.length) {
      setError('Select at least one package');
      return;
    }

    if (!canAfford) {
      setError(
        `Insufficient wallet balance. Required ${formatMoney(chargePreview.effectiveCharge, currencyCode)}.`
      );
      return;
    }

    setSubmitting(true);

    try {
      const result = await operatorApi.createAccount({
        fullName: form.fullName,
        phoneNumber: sanitizePhoneInput(form.phoneNumber),
        serviceTag: form.serviceTag,
        packageIds: activePackageIds.map(Number),
      });

      setWalletBalance(result.walletBalance);
      if (!result.amountCharged) {
        setTrialAccountsRemaining((prev) => Math.max(0, prev - 1));
      }
      toast.success(`Account created for ${result.fullName}`);
      setLastResult(result);
      setForm({ fullName: '', phoneNumber: '', serviceTag: form.serviceTag });
      if (taggedPackages.length === 1) {
        setPackageIds([taggedPackages[0].id]);
      }
    } catch (err) {
      const message = err.message || 'Failed to create account';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled =
    submitting ||
    !formReady ||
    !form.fullName.trim() ||
    !form.phoneNumber.trim();

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="workflow-page-header">
        <div>
          <h1 className="page-title">Create Account</h1>
          <p className="page-subtitle">
            Register a new customer with subscription in one step. Review the order summary on the right before confirming.
          </p>
        </div>
        <WorkflowHeaderWallet balance={walletBalance} currencyCode={currencyCode} />
      </div>

      <div className="workflow-layout">
        <div className="workflow-main">
          {lastResult?.status === 'created' && (
            <div className="success-panel" style={{ marginBottom: 20 }}>
              <p className="success-panel-title">Account created successfully</p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastResult.fullName} · {lastResult.phoneNumber} · {getServiceTagLabel(lastResult.serviceTag)}
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                <strong>Packages:</strong> {(lastResult.packageNames || []).join(', ')}
              </p>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                <strong>Charged:</strong>{' '}
                {formatResultCharge(lastResult.amountCharged, lastResult.currencyCode || currencyCode)}
                {' · '}
                <strong>Balance:</strong>{' '}
                {formatMoney(lastResult.balanceBefore, currencyCode)} →{' '}
                {formatMoney(lastResult.balanceAfter ?? lastResult.walletBalance, currencyCode)}
              </p>
              <div className="success-panel-actions">
                <Link to="/operator/accounts" className="btn btn-primary btn-sm">
                  <List size={16} /> View Accounts
                </Link>
                <Link to="/operator/transactions" className="btn btn-secondary btn-sm">
                  <Receipt size={16} /> View Transaction
                </Link>
              </div>
            </div>
          )}

          <WorkflowStep
            step={1}
            title="Choose product"
            description="Select customer type and the package to activate"
          >
            {taggedPackages.length === 0 && packages.length > 0 && (
              <div className="alert alert-info" style={{ marginBottom: 20 }}>
                No {getServiceTagLabel(form.serviceTag)} packages assigned to your account.
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Customer type</label>
              <ServiceTypePicker
                options={serviceTags}
                value={form.serviceTag}
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
              {taggedPackages.length > 1 && (
                <p className="form-hint" style={{ marginTop: 10 }}>
                  Click a package card to select or deselect. Total updates in the order summary.
                </p>
              )}
            </div>
          </WorkflowStep>

          <WorkflowStep
            step={2}
            title="Customer details"
            description="Enter the new customer's name and mobile number"
          >
            {error && <div className="alert alert-error">{error}</div>}

            <form ref={formRef} onSubmit={handleSubmit}>
              <div className="workflow-form-grid">
                <div className="form-group">
                  <label htmlFor="fullName" className="form-label">Full name</label>
                  <input
                    id="fullName"
                    className="form-input"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="John Doe"
                    required
                    minLength={2}
                    disabled={!formReady}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="phoneNumber" className="form-label">Phone number</label>
                  <input
                    id="phoneNumber"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    className="form-input"
                    value={form.phoneNumber}
                    onChange={(e) => setForm({ ...form, phoneNumber: sanitizePhoneInput(e.target.value) })}
                    placeholder="9XXXXXX"
                    required
                    minLength={MALDIVES_PHONE_LENGTH}
                    maxLength={MALDIVES_PHONE_LENGTH}
                    pattern="[79][0-9]{6}"
                    disabled={!formReady}
                  />
                  <p className="form-hint">{PHONE_HINT}</p>
                </div>
              </div>

              <button type="submit" className="sr-only" disabled={submitDisabled}>
                Submit
              </button>
            </form>
          </WorkflowStep>

          <div className="workflow-footer-links">
            <Link to="/operator/customers?mode=subscribe">Subscribe instead</Link>
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
              chargeAmount={chargePreview.effectiveCharge}
              trialFreeCount={chargePreview.freeCount}
              canAfford={canAfford}
              actionLabel={
                chargePreview.usesTrial
                  ? 'Create Account · Free'
                  : unitCost > 0
                    ? `Create Account · ${formatMoney(unitCost, currencyCode)}`
                    : 'Create Account'
              }
              actionIcon={UserPlus}
              onAction={() => formRef.current?.requestSubmit()}
              actionDisabled={submitDisabled}
              actionLoading={submitting}
              footnote={
                chargePreview.usesTrial
                  ? 'This account uses a free trial slot. Your wallet will not be charged.'
                  : 'Your wallet is charged immediately when the account is created in the system.'
              }
            />
          </div>
        </aside>
      </div>
    </Layout>
  );
}
