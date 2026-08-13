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

export default function CreateAccountPage() {
  const toast = useToast();
  const [form, setForm] = useState({ fullName: '', phoneNumber: '' });
  const [remaining, setRemaining] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    operatorApi.getStats().then((s) => setRemaining(s.remainingQuota));
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

    setSubmitting(true);

    try {
      const result = await operatorApi.createAccount({
        ...form,
        phoneNumber: sanitizePhoneInput(form.phoneNumber),
      });
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
          <p className="card-subtitle">Enter the customer name and phone number</p>
        </div>
        <div className="card-body">
          {lastResult?.status === 'created' && (
            <div className="success-panel">
              <p className="success-panel-title">Account created successfully</p>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {lastResult.fullName} · {lastResult.phoneNumber}
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
              disabled={submitting || remaining === 0}
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
