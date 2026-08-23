import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, List } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { operatorApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import {
  MALDIVES_PHONE_LENGTH,
  PHONE_HINT,
  sanitizePhoneInput,
  getPhoneValidationMessage,
} from '../../utils/phone';

function togglePackageId(currentIds, packageId) {
  const id = Number(packageId);
  const current = currentIds.map(Number);
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export default function CreateAccountPage() {
  const toast = useToast();
  const [form, setForm] = useState({ fullName: '', phoneNumber: '' });
  const [packages, setPackages] = useState([]);
  const [packageIds, setPackageIds] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((s) => {
      setRemaining(s.remainingQuota);
      setPackages(s.packages || []);
      if (s.packages?.length === 1) {
        setPackageIds([s.packages[0].id]);
      }
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLastResult(null);

    const phoneError = getPhoneValidationMessage(form.phoneNumber);
    if (phoneError) {
      setError(phoneError);
      return;
    }

    if (packages.length > 1 && !packageIds.length) {
      setError('Select at least one package before creating an account');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        ...form,
        phoneNumber: sanitizePhoneInput(form.phoneNumber),
      };
      if (packageIds.length) {
        payload.packageIds = packageIds.map(Number);
      }

      const result = await operatorApi.createAccount(payload);
      setRemaining(result.remainingQuota);

      const account = result.created?.[0];
      const createdName = form.fullName;

      if (account?.status === 'created') {
        toast.success(`Account created for ${createdName}`);
        setLastResult({
          fullName: createdName,
          phoneNumber: sanitizePhoneInput(form.phoneNumber),
          externalRef: account.externalRef,
          status: 'created',
        });
      } else {
        toast.error(account?.errorMessage || 'Account creation failed');
        setLastResult({
          fullName: createdName,
          phoneNumber: sanitizePhoneInput(form.phoneNumber),
          errorMessage: account?.errorMessage,
          status: 'failed',
        });
      }

      setForm({ fullName: '', phoneNumber: '' });
    } catch (err) {
      const message = err.message || 'Failed to create account';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPackageNames = packages
    .filter((pkg) => packageIds.map(Number).includes(Number(pkg.id)))
    .map((pkg) => pkg.name);

  return (
    <Layout sidebar={<Sidebar role="operator" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Create Account</h1>
        <p className="page-subtitle">
          Add a new voucher account
          {remaining !== null && ` · ${remaining.toLocaleString()} quota remaining`}
        </p>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-header">
          <h3 className="card-title">New Account</h3>
          <p className="card-subtitle">
            {packages.length > 1
              ? 'Select package(s), then enter the customer details'
              : 'Enter the customer name and phone number'}
          </p>
        </div>
        <div className="card-body">
          {lastResult?.status === 'created' && (
            <div className="success-panel">
              <p className="success-panel-title">Account created successfully</p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastResult.fullName} · {lastResult.phoneNumber}
                {selectedPackageNames.length > 0 && <> · {selectedPackageNames.join(', ')}</>}
                {lastResult.externalRef && (
                  <> · Ref: <strong>{lastResult.externalRef}</strong></>
                )}
              </p>
              <div className="success-panel-actions">
                <Link to="/operator/accounts" className="btn btn-primary btn-sm">
                  <List size={16} /> View in Accounts
                </Link>
              </div>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}

          {remaining === 0 && (
            <div className="alert alert-info">
              You have reached your account creation quota. Contact your administrator.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {packages.length > 1 && (
              <div className="form-group">
                <label className="form-label">Packages</label>
                <div className="package-checkbox-list">
                  {packages.map((pkg) => (
                    <label key={pkg.id} className="package-checkbox-item">
                      <input
                        type="checkbox"
                        checked={packageIds.map(Number).includes(Number(pkg.id))}
                        onChange={() => setPackageIds((prev) => togglePackageId(prev, pkg.id))}
                        disabled={remaining === 0}
                      />
                      <span>{pkg.name}</span>
                    </label>
                  ))}
                </div>
                <p className="form-hint">Select one or more packages to provision for this account.</p>
              </div>
            )}

            {packages.length === 1 && (
              <div className="form-group">
                <label className="form-label">Package</label>
                <p style={{ fontSize: 14, margin: 0 }}>
                  <span className="badge badge-info">{packages[0].name}</span>
                </p>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="fullName" className="form-label">Full Name</label>
              <input
                id="fullName"
                className="form-input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="John Doe"
                required
                minLength={2}
                disabled={remaining === 0}
              />
            </div>

            <div className="form-group">
              <label htmlFor="phoneNumber" className="form-label">Phone Number</label>
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
                aria-describedby="phoneNumber-hint"
                disabled={remaining === 0}
              />
              <p className="form-hint" id="phoneNumber-hint">{PHONE_HINT}</p>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || remaining === 0 || (packages.length > 1 && !packageIds.length)}
            >
              <UserPlus size={18} />
              {submitting ? 'Creating...' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
