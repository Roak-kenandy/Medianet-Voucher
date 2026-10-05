import { useEffect, useState } from 'react';
import Modal from '../Modal';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const ACTIONS = [
  { key: 'add', label: 'Increase' },
  { key: 'deduct', label: 'Deduct' },
  { key: 'revoke', label: 'Revoke all remaining' },
];

/**
 * Staff-side management of an operator's free account quota: increase it, take some of the
 * unused quota back, or revoke everything that is left. Accounts already created for free
 * are never undone.
 */
export default function OperatorTrialQuotaModal({ operator, onClose, onChanged }) {
  const toast = useToast();
  const [action, setAction] = useState('add');
  const [accounts, setAccounts] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const operatorId = operator?.id;
  const limit = Number(operator?.trial_account_limit) || 0;
  const used = Number(operator?.trial_accounts_used) || 0;
  const remaining = Math.max(0, limit - used);

  useEffect(() => {
    setAction('add');
    setAccounts('');
    setNotes('');
    setError('');
  }, [operatorId]);

  const count = Number(accounts) || 0;
  const remainingAfter =
    action === 'add' ? remaining + count : action === 'deduct' ? Math.max(0, remaining - count) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (action !== 'revoke' && count <= 0) {
      setError('Enter how many free accounts');
      return;
    }
    if (action === 'deduct' && count > remaining) {
      setError(`Only ${remaining} unused free account(s) can be deducted`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminApi.adjustOperatorTrialQuota(operatorId, {
        action,
        accounts: action === 'revoke' ? undefined : count,
        notes,
      });
      toast.success(
        `Free accounts for ${operator.client_name}: ${result.trialAccountsRemaining} remaining of ${result.trialAccountLimit}`
      );
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || 'Failed to update free accounts');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!operator}
      onClose={onClose}
      title={`Free Accounts — ${operator?.client_name || ''}`}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            form="trial-quota-form"
            className={`btn ${action === 'add' ? 'btn-primary' : 'btn-danger'}`}
            disabled={submitting || (action !== 'add' && remaining === 0)}
          >
            {submitting ? 'Saving...' : action === 'add' ? 'Increase Quota' : action === 'deduct' ? 'Deduct Quota' : 'Revoke Remaining'}
          </button>
        </>
      )}
    >
      {error && <div className="alert alert-error">{error}</div>}

      <div className="table-wrapper" style={{ marginBottom: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Granted in total</th>
              <th>Already used</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{limit}</td>
              <td>{used}</td>
              <td><strong>{remaining}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <form id="trial-quota-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-group form-group-full">
            <label className="form-label">Action</label>
            <div className="scope-selector">
              {ACTIONS.map((option) => (
                <label
                  key={option.key}
                  className={`scope-selector-item${action === option.key ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="trial-quota-action"
                    checked={action === option.key}
                    onChange={() => { setAction(option.key); setError(''); }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          {action !== 'revoke' && (
            <div className="form-group">
              <label className="form-label">Number of free accounts</label>
              <input
                type="number"
                className="form-input"
                value={accounts}
                onChange={(e) => setAccounts(e.target.value)}
                min={1}
                max={action === 'deduct' ? Math.max(1, remaining) : 10000}
                step={1}
                required
              />
            </div>
          )}
          <div className="form-group form-group-full">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for this change (recorded in the audit log)"
              required
              minLength={3}
              maxLength={500}
            />
          </div>
        </div>
        <p className="form-hint">
          After saving the operator will have <strong>{remainingAfter}</strong> free account(s) remaining.
          {action !== 'add' && ' Accounts already created for free are not affected.'}
          {action !== 'add' && remaining === 0 && ' There is no unused quota to take back.'}
        </p>
      </form>
    </Modal>
  );
}
