import { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Power, Pencil, Users } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import ActionMenu from '../../components/ActionMenu';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { formatPackageLabel } from '../../constants/packages';
import { formatMoney } from '../../utils/money';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';
import {
  SERVICE_SCOPES,
  getServiceScopeLabel,
  packageMatchesScope,
} from '../../constants/serviceTags';
import { Link } from 'react-router-dom';
import PackageSelector from '../../components/admin/PackageSelector';
import PackageBadgeOverflow from '../../components/admin/PackageBadgeOverflow';
import './admin-shared.css';

const emptyForm = () => ({
  clientName: '',
  serviceScope: 'BOTH',
  packageIds: [],
  email: '',
  password: '',
  walletCommissionType: 'none',
  walletCommissionValue: 0,
  notes: '',
  isActive: true,
});

function formatCommissionLabel(operator) {
  const type = operator.wallet_commission_type || 'none';
  const value = Number(operator.wallet_commission_value) || 0;
  if (type === 'fixed') return `+${formatMoney(value, 'MVR')} / top-up`;
  if (type === 'percent') return `+${value}% / top-up`;
  return 'None';
}

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function getOperatorPackageNames(operator) {
  if (operator.package_names?.length) {
    return operator.package_names;
  }

  return (operator.package_name || operator.package_type || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
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
  const [packagesModal, setPackagesModal] = useState(null);

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
      serviceScope: operator.service_scope || 'BOTH',
      packageIds,
      email: operator.email,
      password: '',
      walletCommissionType: operator.wallet_commission_type || 'none',
      walletCommissionValue: Number(operator.wallet_commission_value) || 0,
      notes: operator.notes || '',
      isActive: Boolean(operator.is_active),
    });
    setEditError('');
    setEditModal(operator);
    setMenuOpen(null);
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

  const handleServiceScopeChange = (form, setForm, serviceScope) => {
    const scopedPackages = packages.filter((pkg) => packageMatchesScope(pkg, serviceScope));
    const validIds = form.packageIds
      .map(Number)
      .filter((id) => scopedPackages.some((pkg) => Number(pkg.id) === id));

    setForm({
      ...form,
      serviceScope,
      packageIds: validIds.length
        ? validIds
        : scopedPackages[0]?.id
          ? [scopedPackages[0].id]
          : [],
    });
  };

  const operatorFormFields = (form, setForm, { isEdit = false } = {}) => {
    const scopedPackages = packages.filter((pkg) => packageMatchesScope(pkg, form.serviceScope));

    return (
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
        <label className="form-label">Customer Types</label>
        <div className="scope-selector">
          {SERVICE_SCOPES.map((scope) => (
            <label
              key={scope.key}
              className={`scope-selector-item${form.serviceScope === scope.key ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={`serviceScope-${isEdit ? 'edit' : 'create'}`}
                checked={form.serviceScope === scope.key}
                onChange={() => handleServiceScopeChange(form, setForm, scope.key)}
              />
              <span>{scope.label}</span>
            </label>
          ))}
        </div>
        <p className="form-hint">
          Controls whether this operator can create Mobile accounts, TV accounts, or both.
        </p>
      </div>
      <div className="form-group form-group-full">
        <label className="form-label">Packages</label>
        {!scopedPackages.length ? (
          <p className="form-hint">
            No active packages for {getServiceScopeLabel(form.serviceScope).toLowerCase()}.{' '}
            {canCreatePackage ? (
              <Link to="/admin/packages">Create a package</Link>
            ) : (
              'Ask an Admin or Sales user to create a package'
            )}{' '}
            first.
          </p>
        ) : (
          <PackageSelector
            packages={scopedPackages}
            selectedIds={form.packageIds}
            onChange={(packageIds) => setForm({ ...form, packageIds })}
          />
        )}
        <p className="form-hint">Select one or more packages for the selected customer type(s).</p>
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
        <label className="form-label">Top-up Commission</label>
        <select
          className="form-input"
          value={form.walletCommissionType}
          onChange={(e) =>
            setForm({
              ...form,
              walletCommissionType: e.target.value,
              walletCommissionValue: e.target.value === 'none' ? 0 : form.walletCommissionValue,
            })
          }
        >
          <option value="none">None — credit payment amount only</option>
          <option value="fixed">Fixed bonus (MVR per top-up)</option>
          <option value="percent">Percent bonus (% of payment)</option>
        </select>
        <p className="form-hint">
          Bonus added on top of what the partner pays.
        </p>
      </div>
      {form.walletCommissionType !== 'none' && (
        <div className="form-group">
          <label className="form-label">
            {form.walletCommissionType === 'fixed' ? 'Bonus amount (MVR)' : 'Bonus percent (%)'}
          </label>
          <input
            type="number"
            className="form-input"
            value={form.walletCommissionValue}
            onChange={(e) =>
              setForm({ ...form, walletCommissionValue: parseFloat(e.target.value) || 0 })
            }
            min={0.01}
            max={form.walletCommissionType === 'percent' ? 100 : undefined}
            step={form.walletCommissionType === 'percent' ? 0.1 : 0.01}
            required
          />
        </div>
      )}
      {isEdit && (
        <div className="form-group">
          <label className="form-label">Current Wallet Balance</label>
          <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
            {formatMoney(editModal?.wallet_balance, 'MVR')}
          </p>
          <p className="form-hint">
            {editModal?.accounts_created || 0} accounts created. Partners top up their own balance via the wallet page.
          </p>
        </div>
      )}
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
  };

  return (
    <div className="operators-page">
      <div className="operators-page-chrome">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Operators</h1>
            <p className="page-subtitle">Manage client operators, packages, and account quotas</p>
          </div>
          <div className="page-header-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { resetCreateForm(); setCreateModalOpen(true); }}
            >
              <Plus size={18} />
              Create Operator
            </button>
          </div>
        </div>
      </div>

      <div className="card operators-card">
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
            <div className="table-scroll-container">
            <div className="table-wrapper">
              <table className="table operators-table">
                <thead>
                  <tr>
                    <th>Client Name</th>
                    <th>Services</th>
                    <th>Packages</th>
                    <th>Notes</th>
                    <th>Email</th>
                    <th>Wallet</th>
                    <th>Commission</th>
                    <th>Accounts</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.id}>
                      <td style={{ fontWeight: 500 }}>{op.client_name}</td>
                      <td><span className="badge badge-neutral">{getServiceScopeLabel(op.service_scope || 'BOTH')}</span></td>
                      <td className="operators-packages-cell">
                        <PackageBadgeOverflow
                          names={getOperatorPackageNames(op)}
                          formatLabel={formatPackageLabel}
                          modalTitle={`Packages — ${op.client_name}`}
                          onShowMore={setPackagesModal}
                        />
                      </td>
                      <td className="operators-notes-cell" title={op.notes || ''}>
                        {op.notes ? (op.notes.length > 40 ? `${op.notes.slice(0, 40)}…` : op.notes) : '—'}
                      </td>
                      <td className="operators-email-cell" title={op.email}>{op.email}</td>
                      <td>{formatMoney(op.wallet_balance, 'MVR')}</td>
                      <td style={{ fontSize: 13 }}>{formatCommissionLabel(op)}</td>
                      <td>{op.accounts_created.toLocaleString()}</td>
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
        open={!!packagesModal}
        onClose={() => setPackagesModal(null)}
        title={packagesModal?.title || 'Packages'}
        footer={(
          <button type="button" className="btn btn-secondary" onClick={() => setPackagesModal(null)}>
            Close
          </button>
        )}
      >
        {packagesModal && (
          <>
            <p className="package-badge-overflow-modal-count">
              {packagesModal.labels.length} package{packagesModal.labels.length === 1 ? '' : 's'} assigned
            </p>
            <div className="package-badge-overflow-modal-list">
              {packagesModal.labels.map((label) => (
                <span key={label} className="badge badge-info">
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </Modal>

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
    </div>
  );
}
