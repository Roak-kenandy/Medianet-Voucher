import { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Power, Pencil, Users } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import ActionMenu from '../../components/ActionMenu';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { DEFAULT_PACKAGE, formatPackageLabel } from '../../constants/packages';
import { useToast } from '../../context/ToastContext';
import './admin-shared.css';

const emptyForm = () => ({
  clientName: '',
  packageType: DEFAULT_PACKAGE,
  email: '',
  password: '',
  accountQuota: 500,
  isActive: true,
});

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function OperatorsTab() {
  const toast = useToast();
  const [operators, setOperators] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const menuAnchorRef = useRef(null);
  const [createForm, setCreateForm] = useState(emptyForm());
  const [editForm, setEditForm] = useState(emptyForm());
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const loadOperators = () => {
    setLoading(true);
    adminApi
      .getOperators({ page, limit: 20, search })
      .then((result) => {
        setOperators(result.operators);
        setPagination(result.pagination);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOperators();
    adminApi.getPackages().then(setPackages).catch(() => setPackages([]));
  }, [page, search]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetCreateForm = () => {
    setCreateForm(emptyForm());
    setCreateError('');
  };

  const openEditModal = (operator) => {
    setEditForm({
      clientName: operator.client_name,
      packageType: operator.package_type || DEFAULT_PACKAGE,
      email: operator.email,
      password: '',
      accountQuota: operator.account_quota,
      isActive: Boolean(operator.is_active),
    });
    setEditError('');
    setEditModal(operator);
    setMenuOpen(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    setSubmitting(true);

    try {
      await adminApi.createOperator(createForm);
      setCreateModalOpen(false);
      resetCreateForm();
      toast.success('Operator created successfully');
      loadOperators();
    } catch (err) {
      setCreateError(err.message || 'Failed to create operator');
      if (err.errors) {
        setCreateError(err.errors.map((item) => item.message).join('. '));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    setSubmitting(true);

    try {
      await adminApi.updateOperator(editModal.id, editForm);
      setEditModal(null);
      toast.success('Operator updated successfully');
      loadOperators();
    } catch (err) {
      setEditError(err.message || 'Failed to update operator');
      if (err.errors) {
        setEditError(err.errors.map((item) => item.message).join('. '));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = (operator) => {
    setConfirmTarget(operator);
    setMenuOpen(null);
  };

  const confirmToggleStatus = async () => {
    if (!confirmTarget) return;
    setConfirmLoading(true);
    try {
      await adminApi.updateOperatorStatus(confirmTarget.id, !confirmTarget.is_active);
      toast.success(
        confirmTarget.is_active
          ? `${confirmTarget.client_name} deactivated`
          : `${confirmTarget.client_name} activated`
      );
      loadOperators();
      setConfirmTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to update operator status');
    } finally {
      setConfirmLoading(false);
    }
  };

  const operatorFormFields = (form, setForm, { isEdit = false } = {}) => (
    <>
      <div className="form-group">
        <label className="form-label">Client Name</label>
        <input
          className="form-input"
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          placeholder="e.g. Acme Corporation"
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label">Package</label>
        <select
          className="form-input"
          value={form.packageType}
          onChange={(e) => setForm({ ...form, packageType: e.target.value })}
          required
        >
          {(packages.length ? packages : [{ value: form.packageType, label: form.packageType }]).map((pkg) => (
            <option key={pkg.value} value={pkg.value}>{pkg.label}</option>
          ))}
        </select>
        <p className="form-hint">Each operator can be assigned a different package for account provisioning.</p>
      </div>
      <div className="form-group">
        <label className="form-label">Email</label>
        <input
          type="email"
          className="form-input"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="operator@client.com"
          required
        />
      </div>
      <div className="form-group">
        <label className="form-label">Password</label>
        <input
          type="password"
          className="form-input"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder={
            isEdit
              ? 'Leave blank to keep current password'
              : 'Min 12 chars with upper, lower, number & symbol'
          }
          required={!isEdit}
          minLength={isEdit ? undefined : 12}
        />
        <p className="form-hint">
          {isEdit
            ? 'Only fill in if you want to reset the operator password.'
            : 'Must be at least 12 characters with uppercase, lowercase, number, and special character.'}
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">Account Creation Quota</label>
        <input
          type="number"
          className="form-input"
          value={form.accountQuota}
          onChange={(e) => setForm({ ...form, accountQuota: parseInt(e.target.value, 10) || 0 })}
          min={isEdit ? editModal?.accounts_created || 1 : 1}
          max={100000}
          required
        />
        {isEdit && (
          <p className="form-hint">
            Current usage: {editModal?.accounts_created || 0} accounts created.
          </p>
        )}
      </div>
      {isEdit && (
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
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="tab-toolbar">
        <button className="btn btn-primary" onClick={() => { resetCreateForm(); setCreateModalOpen(true); }}>
          <Plus size={18} />
          Create Operator
        </button>
      </div>

      <div className="card">
        <TableToolbar
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by client name, email, or package..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : operators.length === 0 ? (
            <div className="empty-state">
              <Users className="empty-state-icon" size={48} />
              <p className="empty-state-title">
                {search ? 'No operators match your search' : 'No operators yet'}
              </p>
              <p>{search ? 'Try a different search term' : 'Create your first operator to get started'}</p>
              {!search && (
                <div className="empty-state-action">
                  <button className="btn btn-primary" onClick={() => { resetCreateForm(); setCreateModalOpen(true); }}>
                    <Plus size={18} />
                    Create Operator
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
            <div className="table-wrapper">
              <table className="table operators-table">
                <thead>
                  <tr>
                    <th>Client Name</th>
                    <th>Package</th>
                    <th>Email</th>
                    <th>Quota</th>
                    <th>Used</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.id}>
                      <td style={{ fontWeight: 500 }}>{op.client_name}</td>
                      <td>
                        <span className="badge badge-info">
                          {formatPackageLabel(op.package_type)}
                        </span>
                      </td>
                      <td>{op.email}</td>
                      <td>{op.account_quota.toLocaleString()}</td>
                      <td>{op.accounts_created.toLocaleString()}</td>
                      <td>{Math.max(0, op.account_quota - op.accounts_created).toLocaleString()}</td>
                      <td><StatusBadge active={op.is_active} /></td>
                      <td>{new Date(op.created_at).toLocaleDateString()}</td>
                      <td>
                        <div>
                          <button
                            ref={menuOpen === op.id ? menuAnchorRef : undefined}
                            className="btn btn-secondary btn-sm"
                            onClick={() => setMenuOpen(menuOpen === op.id ? null : op.id)}
                          >
                            <MoreVertical size={16} />
                          </button>
                          <ActionMenu
                            open={menuOpen === op.id}
                            onClose={() => setMenuOpen(null)}
                            anchorRef={menuAnchorRef}
                          >
                            <button
                              className="header-dropdown-item"
                              onClick={() => openEditModal(op)}
                            >
                              <Pencil size={16} /> Edit Operator
                            </button>
                            <button
                              className="header-dropdown-item"
                              onClick={() => handleToggleStatus(op)}
                            >
                              <Power size={16} />
                              {op.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </ActionMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
              itemLabel="operators"
            />
            </>
          )}
        </div>
      </div>

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Operator">
        {createError && <div className="alert alert-error">{createError}</div>}
        <form onSubmit={handleCreate}>
          {operatorFormFields(createForm, setCreateForm)}
          <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Operator'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit Operator">
        {editError && <div className="alert alert-error">{editError}</div>}
        <form onSubmit={handleEdit}>
          <p style={{ marginBottom: 16, color: 'var(--color-text-secondary)' }}>
            Update details for <strong>{editModal?.client_name}</strong>.
          </p>
          {operatorFormFields(editForm, setEditForm, { isEdit: true })}
          <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditModal(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmToggleStatus}
        title={confirmTarget?.is_active ? 'Deactivate operator?' : 'Activate operator?'}
        message={
          confirmTarget?.is_active
            ? `Are you sure you want to deactivate ${confirmTarget.client_name}? They will no longer be able to log in or create accounts.`
            : `Activate ${confirmTarget?.client_name}? They will regain access to the portal.`
        }
        confirmLabel={confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
        variant={confirmTarget?.is_active ? 'danger' : 'primary'}
        loading={confirmLoading}
      />
    </>
  );
}
