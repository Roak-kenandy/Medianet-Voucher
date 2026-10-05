import { useEffect, useState } from 'react';
import { Plus, Pencil, KeyRound, ArrowLeft } from 'lucide-react';
import Modal from '../Modal';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import {
  OPERATOR_PERMISSION_KEYS,
  OPERATOR_PERMISSION_LABELS,
  OPERATOR_PORTAL_ROLE_LABELS,
  defaultOperatorPermissions,
} from '../../constants/operatorPermissions';
import { formatDateTime } from '../../constants/appSettings';

const emptyUserForm = () => ({
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  portalRole: 'user',
  portalPermissions: defaultOperatorPermissions(false),
  isActive: true,
});

function errorText(err, fallback) {
  return err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || fallback;
}

/**
 * Staff-side management of one operator's portal users: view, add, edit, activate or
 * deactivate, and reset passwords. `view` is 'list', 'create', 'edit' or 'password'.
 */
export default function OperatorUsersModal({ operator, onClose, onChanged }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState(emptyUserForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const operatorId = operator?.id;

  const loadUsers = () => {
    if (!operatorId) return;
    setLoading(true);
    adminApi
      .getOperatorUsers(operatorId)
      .then((result) => setUsers(result.users))
      .catch((err) => toast.error(err.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setView('list');
    setTarget(null);
    setUsers([]);
    setError('');
    loadUsers();
  }, [operatorId]);

  const backToList = () => {
    setView('list');
    setTarget(null);
    setError('');
  };

  const openCreate = () => {
    setForm(emptyUserForm());
    setError('');
    setView('create');
  };

  const openEdit = (user) => {
    setTarget(user);
    setForm({
      ...emptyUserForm(),
      name: user.name,
      email: user.email,
      portalRole: user.portalRole,
      portalPermissions: user.portalPermissions,
      isActive: user.isActive,
    });
    setError('');
    setView('edit');
  };

  const openPassword = (user) => {
    setTarget(user);
    setForm(emptyUserForm());
    setError('');
    setView('password');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (view !== 'edit' && form.password !== form.confirmPassword) {
      setError('The passwords do not match');
      return;
    }

    const permissions = form.portalRole === 'user' ? form.portalPermissions : undefined;
    setSubmitting(true);
    try {
      if (view === 'create') {
        await adminApi.createOperatorUser(operatorId, {
          name: form.name,
          email: form.email,
          password: form.password,
          portalRole: form.portalRole,
          portalPermissions: permissions,
        });
        toast.success('User created');
      } else if (view === 'edit') {
        await adminApi.updateOperatorUser(operatorId, target.id, {
          name: form.name,
          email: form.email,
          isActive: form.isActive,
          portalRole: form.portalRole,
          portalPermissions: permissions,
        });
        toast.success('User updated');
      } else {
        await adminApi.resetOperatorUserPassword(operatorId, target.id, form.password);
        toast.success(`Password reset for ${target.name}. Their sessions were ended.`);
      }
      backToList();
      loadUsers();
      onChanged?.();
    } catch (err) {
      setError(errorText(err, 'Request failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const titles = {
    list: `Users — ${operator?.client_name || ''}`,
    create: 'Add User',
    edit: `Edit User — ${target?.name || ''}`,
    password: `Reset Password — ${target?.name || ''}`,
  };

  const passwordFields = (
    <>
      <div className="form-group">
        <label className="form-label">{view === 'password' ? 'New Password' : 'Password'}</label>
        <input
          type="password"
          className="form-input"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          minLength={12}
        />
        <p className="form-hint">
          At least 12 characters with uppercase, lowercase, number, and special character.
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">Confirm Password</label>
        <input
          type="password"
          className="form-input"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          required
          minLength={12}
        />
      </div>
    </>
  );

  const footer =
    view === 'list' ? (
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    ) : (
      <>
        <button type="button" className="btn btn-secondary" onClick={backToList}>
          <ArrowLeft size={16} /> Back to users
        </button>
        <button type="submit" form="operator-user-form" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : view === 'password' ? 'Reset Password' : 'Save User'}
        </button>
      </>
    );

  return (
    <Modal open={!!operator} onClose={onClose} title={titles[view]} extraWide footer={footer}>
      {error && <div className="alert alert-error">{error}</div>}

      {view === 'list' && (
        <>
          <div className="tab-toolbar">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} /> Add User
            </button>
          </div>
          {loading ? (
            <div className="loading-screen" style={{ height: 120 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : users.length === 0 ? (
            <p className="form-hint">This operator has no users yet. Add one so they can sign in.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Login email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th>Sessions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td style={{ fontWeight: 500 }}>{user.name}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className="badge badge-neutral">
                          {OPERATOR_PORTAL_ROLE_LABELS[user.portalRole]}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${user.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {user.isLocked && (
                          <span className="badge badge-danger" style={{ marginLeft: 6 }}>Locked</span>
                        )}
                      </td>
                      <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</td>
                      <td>{user.activeSessions}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(user)}>
                            <Pencil size={14} /> Edit
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPassword(user)}>
                            <KeyRound size={14} /> Reset Password
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!operator?.is_active && (
            <p className="form-hint">
              This operator is deactivated, so none of its users can sign in until it is activated again.
            </p>
          )}
        </>
      )}

      {view !== 'list' && (
        <form id="operator-user-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            {view === 'password' ? (
              <>
                {passwordFields}
                <p className="form-hint form-group-full">
                  Resetting the password signs {target?.name} out everywhere and clears any login lock.
                  Share the new password with them securely.
                </p>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    className="form-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Login Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                  {view === 'edit' && (
                    <p className="form-hint">Changing the email signs this user out everywhere.</p>
                  )}
                </div>
                {view === 'create' && passwordFields}
                <div className="form-group form-group-full">
                  <label className="form-label">Portal role</label>
                  <div className="scope-selector">
                    {['supervisor', 'user'].map((roleKey) => (
                      <label
                        key={roleKey}
                        className={`scope-selector-item${form.portalRole === roleKey ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="operator-user-role"
                          checked={form.portalRole === roleKey}
                          onChange={() => setForm({ ...form, portalRole: roleKey })}
                        />
                        <span>{OPERATOR_PORTAL_ROLE_LABELS[roleKey]}</span>
                      </label>
                    ))}
                  </div>
                  <p className="form-hint">
                    Supervisor has full portal access. Normal user only sees the sections you allow below.
                  </p>
                </div>
                {form.portalRole === 'user' && (
                  <div className="form-group form-group-full">
                    <label className="form-label">Normal user access</label>
                    <div className="operator-permissions-grid">
                      {OPERATOR_PERMISSION_KEYS.map((key) => (
                        <label key={key} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={Boolean(form.portalPermissions?.[key])}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                portalPermissions: { ...form.portalPermissions, [key]: e.target.checked },
                              })
                            }
                          />
                          <span>{OPERATOR_PERMISSION_LABELS[key]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {view === 'edit' && (
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select
                      className="form-input"
                      value={form.isActive ? 'active' : 'inactive'}
                      onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <p className="form-hint">
                      Deactivating signs this user out. Activating also clears a login lock.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
