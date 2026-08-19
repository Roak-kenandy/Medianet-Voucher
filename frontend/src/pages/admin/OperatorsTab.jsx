import { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Power, Pencil, Users } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import ActionMenu from '../../components/ActionMenu';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { formatPackageLabel } from '../../constants/packages';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';
import { Link } from 'react-router-dom';
import './admin-shared.css';

const emptyForm = () => ({
  clientName: '',
  packageIds: [],
  email: '',
  password: '',
  accountQuota: 500,
  notes: '',
  isActive: true,
});

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function PackageBadges({ operator }) {
  const names = operator.package_names?.length
    ? operator.package_names
    : (operator.package_name || operator.package_type || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

  if (!names.length) return '—';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {names.map((name) => (
        <span key={name} className="badge badge-info">
          {formatPackageLabel(name)}
        </span>
      ))}
    </div>
  );
}

export default function OperatorsTab() {
  const { user } = useAuth();
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
    adminApi.getPackages().then((items) => {
      setPackages(items);
      setCreateForm((prev) => ({
        ...prev,
        packageIds: prev.packageIds.length ? prev.packageIds : items[0]?.id ? [items[0].id] : [],
      }));
    }).catch(() => setPackages([]));
  }, [page, search]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetCreateForm = () => {
    setCreateForm({
      ...emptyForm(),
      packageIds: packages[0]?.id ? [packages[0].id] : [],
    });
    setCreateError('');
  };

  const openEditModal = (operator) => {
    const packageIds = operator.package_ids?.length
      ? operator.package_ids
      : operator.package_id
        ? [operator.package_id]
        : packages[0]?.id
          ? [packages[0].id]
          : [];

    setEditForm({
      clientName: operator.client_name,
      packageIds,
      email: operator.email,
      password: '',
      accountQuota: operator.account_quota,
      notes: operator.notes || '',
      isActive: Boolean(operator.is_active),
    });
    setEditError('');
    setEditModal(operator);
    setMenuOpen(null);
  };

  const togglePackageId = (form, setForm, packageId) => {
    const id = Number(packageId);
    const current = form.packageIds.map(Number);
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setForm({ ...form, packageIds: next });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');

    if (!createForm.packageIds.length) {
      setCreateError('Select at least one package');
      return;
    }

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

    if (!editForm.packageIds.length) {
      setEditError('Select at least one package');
      return;
    }

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

  const canCreatePackage = hasPermission(user?.role, 'createPackage');

  const operatorFormFields = (form, setForm, { isEdit = false } = {}) => (
    <div className="form-grid">
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
      <div className="form-group form-group-full">
        <label className="form-label">Packages</label>
        {!packages.length ? (
          <p className="form-hint">
            No active packages.{' '}
            {canCreatePackage ? (
              <Link to="/admin/packages">Create a package</Link>
            ) : (
              'Ask an Admin or Sales user to create a package'
            )}{' '}
            first.
          </p>
        ) : (
          <div className="package-checkbox-list">
            {packages.map((pkg) => (
              <label key={pkg.id} className="package-checkbox-item">
                <input
                  type="checkbox"
                  checked={form.packageIds.map(Number).includes(Number(pkg.id))}
                  onChange={() => togglePackageId(form, setForm, pkg.id)}
                />
                <span>{pkg.label || pkg.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="form-hint">Select one or more packages. All selected packages are provisioned when this operator creates an account.</p>
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
      <div className="form-group form-group-full">
        <label className="form-label">Notes</label>
        <textarea
          className="form-input"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Internal notes about this operator (optional)"
          rows={2}
        />
        <p className="form-hint">Use notes for contract details, billing references, or support context.</p>
      </div>
    </div>
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
                    <th>Packages</th>
                    <th>Notes</th>
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
                      <td><PackageBadges operator={op} /></td>
                      <td style={{ maxWidth: 220, fontSize: 13, color: 'var(--color-text-secondary)' }} title={op.notes || ''}>
                        {op.notes ? (op.notes.length > 60 ? `${op.notes.slice(0, 60)}…` : op.notes) : '—'}
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

      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Operator"
        wide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="create-operator-form"
              className="btn btn-primary"
              disabled={submitting || !packages.length}
            >
              {submitting ? 'Creating...' : 'Create Operator'}
            </button>
          </>
        )}
      >
        {createError && <div className="alert alert-error">{createError}</div>}
        <form id="create-operator-form" onSubmit={handleCreate}>
          {operatorFormFields(createForm, setCreateForm)}
        </form>
      </Modal>

      <Modal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        title="Edit Operator"
        wide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditModal(null)}>
              Cancel
            </button>
            <button
              type="submit"
              form="edit-operator-form"
              className="btn btn-primary"
              disabled={submitting || !packages.length}
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        )}
      >
        {editError && <div className="alert alert-error">{editError}</div>}
        <form id="edit-operator-form" onSubmit={handleEdit}>
          <p style={{ marginBottom: 16, color: 'var(--color-text-secondary)' }}>
            Update details for <strong>{editModal?.client_name}</strong>.
          </p>
          {operatorFormFields(editForm, setEditForm, { isEdit: true })}
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
