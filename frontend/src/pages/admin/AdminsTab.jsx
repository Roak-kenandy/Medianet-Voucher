import { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Power, Shield, KeyRound } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import ActionMenu from '../../components/ActionMenu';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { hasPermission, ROLE_LABELS } from '../../constants/permissions';
import RoleSelector from '../../components/admin/RoleSelector';
import './admin-shared.css';
import { formatDate } from '../../constants/appSettings';

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function AdminsTab() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [admins, setAdmins] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const menuAnchorRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'sales' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  // { mode: 'own' } or { mode: 'reset', admin }
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  const loadAdmins = () => {
    setLoading(true);
    adminApi
      .getAdmins({ page, limit: 20, search })
      .then((result) => {
        setAdmins(result.admins);
        setPagination(result.pagination);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAdmins();
  }, [page, search]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const canCreateAdmin = hasPermission(user?.role, 'createAdmin');
  const canManageAdminStatus = hasPermission(user?.role, 'manageAdminStatus');

  const resetForm = () => {
    setForm({ name: '', email: '', password: '', role: 'sales' });
    setError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await adminApi.createAdmin(form);
      setModalOpen(false);
      resetForm();
      toast.success('Staff account created successfully');
      loadAdmins();
    } catch (err) {
      setError(err.message || 'Failed to create admin');
      if (err.errors) {
        setError(err.errors.map((e) => e.message).join('. '));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openPasswordModal = (target) => {
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordError('');
    setPasswordModal(target);
    setMenuOpen(null);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('The new passwords do not match');
      return;
    }
    setPasswordSubmitting(true);
    try {
      if (passwordModal.mode === 'own') {
        await adminApi.changeMyPassword({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        });
        setPasswordModal(null);
        toast.success('Password changed. Please sign in again.');
        await logout();
      } else {
        await adminApi.resetAdminPassword(passwordModal.admin.id, passwordForm.newPassword);
        setPasswordModal(null);
        toast.success(`Password reset for ${passwordModal.admin.name}. Their sessions were ended.`);
      }
    } catch (err) {
      setPasswordError(
        err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || 'Failed to change password'
      );
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleToggleStatus = (admin) => {
    setConfirmTarget(admin);
    setMenuOpen(null);
  };

  const confirmToggleStatus = async () => {
    if (!confirmTarget) return;
    setConfirmLoading(true);
    try {
      await adminApi.updateAdminStatus(confirmTarget.id, !confirmTarget.is_active);
      toast.success(
        confirmTarget.is_active
          ? `${confirmTarget.name} deactivated`
          : `${confirmTarget.name} activated`
      );
      loadAdmins();
      setConfirmTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to update admin status');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <>
      <div className="tab-toolbar">
        <button className="btn btn-secondary" onClick={() => openPasswordModal({ mode: 'own' })}>
          <KeyRound size={18} />
          Change My Password
        </button>
        {canCreateAdmin && (
          <button className="btn btn-primary" onClick={() => { resetForm(); setModalOpen(true); }}>
            <Plus size={18} />
            Create Staff Account
          </button>
        )}
      </div>

      <div className="card">
        <TableToolbar
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name or email..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : admins.length === 0 ? (
            <div className="empty-state">
              <Shield className="empty-state-icon" size={48} />
              <p className="empty-state-title">
                {search ? 'No staff match your search' : 'No staff accounts found'}
              </p>
              <p>{search ? 'Try a different search term' : 'Create staff accounts to share portal access'}</p>
              {!search && canCreateAdmin && (
                <div className="empty-state-action">
                  <button className="btn btn-primary" onClick={() => { resetForm(); setModalOpen(true); }}>
                    <Plus size={18} />
                    Create Staff Account
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
            <div className="table-scroll-container">
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id}>
                      <td style={{ fontWeight: 500 }}>
                        {admin.name}
                        {user?.id === admin.id && (
                          <span className="badge badge-info" style={{ marginLeft: 8 }}>You</span>
                        )}
                      </td>
                      <td>{admin.email}</td>
                      <td>
                        <span className="badge badge-neutral">
                          {ROLE_LABELS[admin.role] || admin.role || 'Admin'}
                        </span>
                      </td>
                      <td><StatusBadge active={admin.is_active} /></td>
                      <td>{formatDate(admin.created_at)}</td>
                      <td>
                        {user?.id !== admin.id && (canManageAdminStatus || canCreateAdmin) && (
                          <div>
                            <button
                              ref={menuOpen === admin.id ? menuAnchorRef : undefined}
                              className="btn btn-secondary btn-sm"
                              onClick={() => setMenuOpen(menuOpen === admin.id ? null : admin.id)}
                            >
                              <MoreVertical size={16} />
                            </button>
                            <ActionMenu
                              open={menuOpen === admin.id}
                              onClose={() => setMenuOpen(null)}
                              anchorRef={menuAnchorRef}
                            >
                              {canCreateAdmin && (
                                <button
                                  className="header-dropdown-item"
                                  onClick={() => openPasswordModal({ mode: 'reset', admin })}
                                >
                                  <KeyRound size={16} /> Reset Password
                                </button>
                              )}
                              {canManageAdminStatus && (
                                <button
                                  className="header-dropdown-item"
                                  onClick={() => handleToggleStatus(admin)}
                                >
                                  <Power size={16} />
                                  {admin.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                              )}
                            </ActionMenu>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
            <TablePagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
              itemLabel="staff"
            />
            </>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create Staff Account"
        wide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="create-admin-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Account'}
            </button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="create-admin-form" onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="John Doe"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="staff@medianet.mv"
                required
              />
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Role</label>
              <RoleSelector
                value={form.role}
                onChange={(role) => setForm({ ...form, role })}
              />
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 12 chars with upper, lower, number & symbol"
                required
                minLength={12}
              />
              <p className="form-hint">
                Must be at least 12 characters with uppercase, lowercase, number, and special character.
              </p>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!passwordModal}
        onClose={() => setPasswordModal(null)}
        title={passwordModal?.mode === 'own' ? 'Change My Password' : `Reset Password — ${passwordModal?.admin?.name || ''}`}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPasswordModal(null)}>
              Cancel
            </button>
            <button type="submit" form="staff-password-form" className="btn btn-primary" disabled={passwordSubmitting}>
              {passwordSubmitting ? 'Saving...' : 'Save Password'}
            </button>
          </>
        )}
      >
        {passwordError && <div className="alert alert-error">{passwordError}</div>}
        <form id="staff-password-form" onSubmit={handlePasswordSubmit}>
          <div className="form-grid">
            {passwordModal?.mode === 'own' && (
              <div className="form-group form-group-full">
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  className="form-input"
                  autoComplete="current-password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  required
                />
              </div>
            )}
            <div className="form-group form-group-full">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-input"
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={12}
              />
              <p className="form-hint">
                At least 12 characters with uppercase, lowercase, number, and special character.
              </p>
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Confirm New Password</label>
              <input
                type="password"
                className="form-input"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
                minLength={12}
              />
              <p className="form-hint">
                {passwordModal?.mode === 'own'
                  ? 'You will be signed out everywhere and asked to sign in again.'
                  : 'This ends all of their sessions. Share the new password with them securely.'}
              </p>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmToggleStatus}
        title={confirmTarget?.is_active ? 'Deactivate admin?' : 'Activate admin?'}
        message={
          confirmTarget?.is_active
            ? `Are you sure you want to deactivate ${confirmTarget?.name}? They will no longer be able to log in.`
            : `Activate ${confirmTarget?.name}? They will regain access to the admin portal.`
        }
        confirmLabel={confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
        variant={confirmTarget?.is_active ? 'danger' : 'primary'}
        loading={confirmLoading}
      />
    </>
  );
}
