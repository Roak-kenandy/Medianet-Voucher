import { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical, Power, Pencil, Users, UserCog, Package, Gift, KeyRound, Copy, Trash2 } from 'lucide-react';
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
  getServiceTypes,
  getServiceScopeLabel,
  packageMatchesScope,
  packageMatchesSalesModels,
} from '../../constants/serviceTags';
import { Link } from 'react-router-dom';
import PackageSelector from '../../components/admin/PackageSelector';
import OperatorUsersModal from '../../components/admin/OperatorUsersModal';
import OperatorPackagesModal from '../../components/admin/OperatorPackagesModal';
import OperatorTrialQuotaModal from '../../components/admin/OperatorTrialQuotaModal';
import PackageGroupPicker from '../../components/admin/PackageGroupPicker';
import {
  OPERATOR_PERMISSION_KEYS,
  OPERATOR_PERMISSION_LABELS,
  OPERATOR_PORTAL_ROLE_LABELS,
  defaultOperatorPermissions,
} from '../../constants/operatorPermissions';
import './admin-shared.css';
import { formatDateTime, formatDate } from '../../constants/appSettings';

const emptyForm = () => ({
  clientName: '',
  serviceTypeKeys: [],
  defaultServiceTypeKey: '',
  salesModelIds: [],
  packageIds: [],
  packageGroupIds: [],
  email: '',
  password: '',
  userName: '',
  walletCommissionType: 'none',
  walletCommissionValue: '',
  canSelfTopup: true,
  generateApiKey: false,
  portalRole: 'supervisor',
  portalPermissions: defaultOperatorPermissions(false),
  notes: '',
  isActive: true,
});

const COMMISSION_TYPES = [
  { key: 'none', label: 'None' },
  { key: 'percent', label: 'Percent (%)' },
  { key: 'multiplier', label: 'Ratio (multiplier)' },
];

/** Form state for the operator's wallet top-up commission: a percent bonus or a ratio. */
function commissionFromOperator(operator) {
  const type = operator.wallet_commission_type || 'none';
  const value = Number(operator.wallet_commission_value) || 0;
  if (type === 'multiplier' && value > 1) {
    return { walletCommissionType: 'multiplier', walletCommissionValue: value };
  }
  if (type === 'percent' && value > 0) {
    return { walletCommissionType: 'percent', walletCommissionValue: value };
  }
  return { walletCommissionType: 'none', walletCommissionValue: '' };
}

function commissionPayload(type, rawValue) {
  const value = Number(rawValue);
  if (type === 'multiplier' && Number.isFinite(value) && value > 1) {
    return { walletCommissionType: 'multiplier', walletCommissionValue: value };
  }
  if (type === 'percent' && Number.isFinite(value) && value > 0) {
    return { walletCommissionType: 'percent', walletCommissionValue: value };
  }
  return { walletCommissionType: 'none', walletCommissionValue: 1 };
}

function formatCommissionLabel(operator) {
  const { walletCommissionType: type, walletCommissionValue: value } = commissionFromOperator(operator);
  if (type === 'multiplier') {
    const bonusPercent = Math.round((value - 1) * 10000) / 100;
    return `×${Math.round(value * 100000) / 100000} (+${bonusPercent}%)`;
  }
  if (type === 'percent') {
    return `+${value}%`;
  }
  return 'None';
}

/** Worked example shown under the commission field so staff can check what they entered. */
function commissionExample(type, rawValue) {
  const value = Number(rawValue);
  if (type === 'percent' && value > 0) {
    return `A 1,000 MVR payment counts as ${formatMoney(1000 + 1000 * (value / 100), 'MVR')} before GST.`;
  }
  if (type === 'multiplier' && value > 1) {
    return `A 1,000 MVR payment counts as ${formatMoney(1000 * value, 'MVR')} before GST.`;
  }
  return null;
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
  const [packageGroups, setPackageGroups] = useState([]);
  const [salesModels, setSalesModels] = useState([]);
  const serviceTypeOptions = getServiceTypes({ activeOnly: true });

  /** Packages an operator with these customer types and sales models may be given. */
  const packagesFor = (form) =>
    packages.filter(
      (pkg) => packageMatchesScope(pkg, form.serviceTypeKeys) && packageMatchesSalesModels(pkg, form.salesModelIds)
    );
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
  const [issuedKey, setIssuedKey] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiAccessEnabled, setApiAccessEnabled] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [revokeKeyTarget, setRevokeKeyTarget] = useState(null);
  const [usersModal, setUsersModal] = useState(null);
  const [trialModal, setTrialModal] = useState(null);
  const canAdjustWallet = hasPermission(user?.role, 'adjustWallet');

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
    }).catch(() => setPackages([]));
    adminApi.getPackageGroups().then(setPackageGroups).catch(() => setPackageGroups([]));
    adminApi
      .getSalesModels()
      .then((models) => setSalesModels(models.filter((model) => model.isActive)))
      .catch(() => setSalesModels([]));
  }, [page, search]);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetCreateForm = () => {
    // New operators start with every customer type and, when there is only one, that sales model.
    const typeKeys = serviceTypeOptions.map((type) => type.key);
    setCreateForm({
      ...emptyForm(),
      serviceTypeKeys: typeKeys,
      defaultServiceTypeKey: typeKeys[0] || '',
      salesModelIds: salesModels.length === 1 ? [salesModels[0].id] : [],
    });
    setCreateError('');
  };

  const openEditModal = (operator) => {
    // Individual packages only; packages inherited from groups are shown through the group.
    const packageIds = operator.direct_package_ids || [];

    setEditForm({
      clientName: operator.client_name,
      serviceTypeKeys: operator.service_type_keys || [],
      defaultServiceTypeKey: operator.default_service_type_key || operator.service_type_keys?.[0] || '',
      salesModelIds: operator.sales_model_ids || [],
      packageIds,
      packageGroupIds: operator.package_group_ids || [],
      email: operator.email,
      ...commissionFromOperator(operator),
      canSelfTopup: operator.wallet_self_topup_enabled !== 0,
      notes: operator.notes || '',
      isActive: Boolean(operator.is_active),
    });
    setEditError('');
    setEditModal(operator);
    setMenuOpen(null);
    setNewKeyName('');
    loadApiKeys(operator.id);
  };

  const loadApiKeys = (operatorId) => {
    setApiKeys([]);
    setApiKeysLoading(true);
    adminApi
      .getOperatorApiKeys(operatorId)
      .then((result) => {
        setApiKeys(result.apiKeys);
        setApiAccessEnabled(Boolean(result.apiAccessEnabled));
      })
      .catch((err) => toast.error(err.message || 'Failed to load API keys'))
      .finally(() => setApiKeysLoading(false));
  };

  const toggleApiAccess = async (enabled) => {
    setApiKeyBusy(true);
    try {
      const result = await adminApi.setOperatorApiAccess(editModal.id, enabled);
      setApiAccessEnabled(result.apiAccessEnabled);
      toast.success(enabled ? 'API access turned on' : 'API access turned off');
    } catch (err) {
      toast.error(err.message || 'Failed to update API access');
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleGenerateApiKey = async () => {
    if (!editModal) return;
    setApiKeyBusy(true);
    try {
      const created = await adminApi.createOperatorApiKey(editModal.id, { name: newKeyName });
      setIssuedKey({ clientName: editModal.client_name, ...created });
      setNewKeyName('');
      loadApiKeys(editModal.id);
    } catch (err) {
      toast.error(err.message || 'Failed to generate API key');
    } finally {
      setApiKeyBusy(false);
    }
  };

  const confirmRevokeApiKey = async () => {
    if (!editModal || !revokeKeyTarget) return;
    setApiKeyBusy(true);
    try {
      await adminApi.revokeOperatorApiKey(editModal.id, revokeKeyTarget.id);
      toast.success('API key revoked');
      setRevokeKeyTarget(null);
      loadApiKeys(editModal.id);
    } catch (err) {
      toast.error(err.message || 'Failed to revoke API key');
    } finally {
      setApiKeyBusy(false);
    }
  };

  const copyIssuedKey = async () => {
    try {
      await navigator.clipboard.writeText(issuedKey.apiKey);
      toast.success('API key copied');
    } catch {
      toast.error('Copy failed. Select the key and copy it manually.');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');

    if (!createForm.serviceTypeKeys.length) {
      setCreateError('Select at least one customer type');
      return;
    }
    if (!createForm.salesModelIds.length) {
      setCreateError('Select at least one sales model');
      return;
    }
    if (!createForm.packageIds.length && !createForm.packageGroupIds.length) {
      setCreateError('Select at least one package or package group');
      return;
    }

    setSubmitting(true);

    try {
      const { walletCommissionType, walletCommissionValue, ...formData } = createForm;
      const created = await adminApi.createOperator({
        ...formData,
        ...commissionPayload(walletCommissionType, walletCommissionValue),
        portalPermissions:
          formData.portalRole === 'user' ? formData.portalPermissions : undefined,
      });
      setCreateModalOpen(false);
      resetCreateForm();
      toast.success('Operator created successfully');
      if (created?.apiKey?.apiKey) {
        setIssuedKey({ clientName: created.clientName, ...created.apiKey });
      }
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

    if (!editForm.serviceTypeKeys.length) {
      setEditError('Select at least one customer type');
      return;
    }
    if (!editForm.salesModelIds.length) {
      setEditError('Select at least one sales model');
      return;
    }
    if (!editForm.packageIds.length && !editForm.packageGroupIds.length) {
      setEditError('Select at least one package or package group');
      return;
    }

    setSubmitting(true);

    try {
      const { walletCommissionType, walletCommissionValue, ...formData } = editForm;
      await adminApi.updateOperator(editModal.id, {
        ...formData,
        ...commissionPayload(walletCommissionType, walletCommissionValue),
      });
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

  /** Applies a change to the customer types or sales models and drops packages that no longer fit. */
  const handleAccessChange = (form, setForm, patch) => {
    const next = { ...form, ...patch };
    if (!next.serviceTypeKeys.includes(next.defaultServiceTypeKey)) {
      next.defaultServiceTypeKey = next.serviceTypeKeys[0] || '';
    }
    const allowedIds = packagesFor(next).map((pkg) => Number(pkg.id));
    next.packageIds = next.packageIds.map(Number).filter((id) => allowedIds.includes(id));
    setForm(next);
  };

  const toggleInList = (list, value) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const operatorFormFields = (form, setForm, { isEdit = false } = {}) => {
    const scopedPackages = packagesFor(form);

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
        <div className="operator-permissions-grid">
          {serviceTypeOptions.map((type) => {
            const checked = form.serviceTypeKeys.includes(type.key);
            return (
              <div key={type.key}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      handleAccessChange(form, setForm, {
                        serviceTypeKeys: toggleInList(form.serviceTypeKeys, type.key),
                      })
                    }
                  />
                  <span>{type.label}</span>
                </label>
                {checked && form.serviceTypeKeys.length > 1 && (
                  <label className="checkbox-label" style={{ marginLeft: 24, fontSize: 13 }}>
                    <input
                      type="radio"
                      name={`defaultServiceType-${isEdit ? 'edit' : 'create'}`}
                      checked={form.defaultServiceTypeKey === type.key}
                      onChange={() => setForm({ ...form, defaultServiceTypeKey: type.key })}
                    />
                    <span>Default</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <p className="form-hint">
          The operator can look up and create customers of the ticked types only. The default type is
          preselected for the operator. Types are configured under CRM Settings.
        </p>
      </div>
      <div className="form-group form-group-full">
        <label className="form-label">Sales Models</label>
        {salesModels.length === 0 ? (
          <p className="form-hint">No sales models configured. Add one under CRM Settings first.</p>
        ) : (
          <div className="operator-permissions-grid">
            {salesModels.map((model) => (
              <label key={model.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.salesModelIds.includes(model.id)}
                  onChange={() =>
                    handleAccessChange(form, setForm, {
                      salesModelIds: toggleInList(form.salesModelIds, model.id),
                    })
                  }
                />
                <span>{model.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="form-hint">
          The operator can only be given packages priced under the ticked sales models.
        </p>
      </div>
      <div className="form-group form-group-full">
        <label className="form-label">Package groups (shared with other operators)</label>
        <PackageGroupPicker
          groups={packageGroups}
          selectedIds={form.packageGroupIds || []}
          onChange={(packageGroupIds) => setForm({ ...form, packageGroupIds })}
          serviceScope={form.serviceTypeKeys}
          salesModelIds={form.salesModelIds}
        />
        <p className="form-hint">
          The operator gets every package in the ticked groups. Changing a group later changes all of its
          operators at once.
        </p>
      </div>
      <div className="form-group form-group-full">
        <label className="form-label">Individual packages (this operator only)</label>
        {!scopedPackages.length ? (
          <p className="form-hint">
            No active packages for the selected customer types and sales models.{' '}
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
        <p className="form-hint">
          Optional when a package group is ticked. Select packages for the selected customer type(s).
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">{isEdit ? 'Contact Email' : 'Email'}</label>
        <input
          type="email"
          className="form-input"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="operator@client.com"
          required
        />
        <p className="form-hint">
          {isEdit
            ? 'Company contact address. Logins and passwords are under Manage Users.'
            : 'Contact address for the operator and the login email of its first user.'}
        </p>
      </div>
      {!isEdit && (
        <div className="form-group">
          <label className="form-label">First User Password</label>
          <input
            type="password"
            className="form-input"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Min 12 chars with upper, lower, number & symbol"
            required
            minLength={12}
          />
        </div>
      )}
      {!isEdit && (
        <div className="form-group">
          <label className="form-label">First User Name (optional)</label>
          <input
            className="form-input"
            value={form.userName}
            onChange={(e) => setForm({ ...form, userName: e.target.value })}
            placeholder="Defaults to the client name"
            maxLength={200}
          />
          <p className="form-hint">More users can be added later from Manage Users.</p>
        </div>
      )}
      <div className="form-group form-group-full">
        <label className="form-label">Wallet top-up commission</label>
        <div className="scope-selector">
          {COMMISSION_TYPES.map((option) => (
            <label
              key={option.key}
              className={`scope-selector-item${form.walletCommissionType === option.key ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={`walletCommissionType-${isEdit ? 'edit' : 'create'}`}
                checked={form.walletCommissionType === option.key}
                onChange={() =>
                  setForm({ ...form, walletCommissionType: option.key, walletCommissionValue: '' })
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {form.walletCommissionType !== 'none' && (
          <input
            type="number"
            className="form-input"
            style={{ marginTop: 8, maxWidth: 260 }}
            value={form.walletCommissionValue}
            onChange={(e) =>
              setForm({
                ...form,
                walletCommissionValue: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            min={form.walletCommissionType === 'percent' ? 0.01 : 1.01}
            max={form.walletCommissionType === 'percent' ? 900 : 10}
            step={form.walletCommissionType === 'percent' ? '0.01' : 'any'}
            list={form.walletCommissionType === 'percent' ? `commissionPercents-${isEdit ? 'edit' : 'create'}` : undefined}
            placeholder={form.walletCommissionType === 'percent' ? 'e.g. 50 for a 50% bonus' : 'e.g. 1.5 for a 50% bonus'}
            required
          />
        )}
        {form.walletCommissionType === 'percent' && (
          <datalist id={`commissionPercents-${isEdit ? 'edit' : 'create'}`}>
            {[10, 20, 30, 40, 50].map((percent) => (
              <option key={percent} value={percent} />
            ))}
          </datalist>
        )}
        <p className="form-hint">
          Bonus added to the operator's wallet top-ups, before GST. Enter it as a percent (50) or as a
          ratio (1.5); both give the same result. Customer sales earn no commission.
          {commissionExample(form.walletCommissionType, form.walletCommissionValue)
            ? ` ${commissionExample(form.walletCommissionType, form.walletCommissionValue)}`
            : ''}
        </p>
      </div>
      <div className="form-group form-group-full">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(form.canSelfTopup)}
            onChange={(e) => setForm({ ...form, canSelfTopup: e.target.checked })}
          />
          <span>Operator can top up wallet themselves</span>
        </label>
        <p className="form-hint">
          When unchecked, Medianet staff must add wallet credit for this operator. They can still view balance and use the wallet.
        </p>
      </div>
      {!isEdit && (
      <div className="form-group form-group-full">
        <label className="form-label">First user's portal role</label>
        <div className="scope-selector">
          {['supervisor', 'user'].map((roleKey) => (
            <label
              key={roleKey}
              className={`scope-selector-item${form.portalRole === roleKey ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={`portalRole-${isEdit ? 'edit' : 'create'}`}
                checked={form.portalRole === roleKey}
                onChange={() =>
                  setForm({
                    ...form,
                    portalRole: roleKey,
                    portalPermissions:
                      roleKey === 'user'
                        ? form.portalPermissions || defaultOperatorPermissions(false)
                        : defaultOperatorPermissions(true),
                  })
                }
              />
              <span>{OPERATOR_PORTAL_ROLE_LABELS[roleKey]}</span>
            </label>
          ))}
        </div>
        <p className="form-hint">
          Supervisor has full portal access. Normal user only sees the sections you allow below.
        </p>
      </div>
      )}
      {!isEdit && form.portalRole === 'user' && (
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
                      portalPermissions: {
                        ...form.portalPermissions,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                <span>{OPERATOR_PERMISSION_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {!isEdit && (
        <div className="form-group form-group-full">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(form.generateApiKey)}
              onChange={(e) => setForm({ ...form, generateApiKey: e.target.checked })}
            />
            <span>Generate an API key for this operator</span>
          </label>
          <p className="form-hint">
            For the operator API. The key is shown once after the operator is created. You can also
            generate or revoke keys later from Edit Operator.
          </p>
        </div>
      )}
      {isEdit && (
        <div className="form-group form-group-full">
          <label className="form-label">API access</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={apiAccessEnabled}
              disabled={apiKeysLoading || apiKeyBusy}
              onChange={(e) => toggleApiAccess(e.target.checked)}
            />
            Allow this operator to use the API and see the Developer API documentation
          </label>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Turns on automatically when a key is generated. Turning it off blocks all of the
            operator's keys without revoking them and hides the documentation. Saved immediately.
          </p>
          <label className="form-label">API keys</label>
          {apiKeysLoading ? (
            <p className="form-hint">Loading keys…</p>
          ) : apiKeys.length === 0 ? (
            <p className="form-hint">No API keys have been issued for this operator.</p>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td><code>{key.keyPrefix}_…</code></td>
                      <td>
                        {formatDate(key.createdAt)}
                        {key.createdByName ? ` · ${key.createdByName}` : ''}
                      </td>
                      <td>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'Never'}</td>
                      <td>
                        <span className={`badge ${key.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {key.isActive ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td>
                        {key.isActive && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setRevokeKeyTarget(key)}
                            disabled={apiKeyBusy}
                          >
                            <Trash2 size={14} /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              className="form-input"
              style={{ maxWidth: 260 }}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (optional)"
              maxLength={120}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGenerateApiKey}
              disabled={apiKeyBusy}
            >
              <KeyRound size={16} /> Generate API key
            </button>
          </div>
          <p className="form-hint">
            A new key is shown once, straight after it is generated. Revoke a key that is lost or no
            longer needed.
          </p>
        </div>
      )}
      {isEdit && (
        <div className="form-group">
          <label className="form-label">Current Wallet Balance</label>
          <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
            {formatMoney(editModal?.wallet_balance, 'MVR')}
          </p>
          <p className="form-hint">
            {editModal?.accounts_created || 0} accounts created.
            {form.canSelfTopup
              ? ' Operator can pay via the wallet page.'
              : ' Wallet top-up is handled by Medianet staff only.'}
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
                    <th>Free accounts</th>
                    <th>Users</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.id}>
                      <td style={{ fontWeight: 500 }}>{op.client_name}</td>
                      <td><span className="badge badge-neutral">{getServiceScopeLabel(op.service_type_keys || [])}</span></td>
                      <td className="operators-packages-cell">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setPackagesModal(op)}
                          title={getOperatorPackageNames(op).map(formatPackageLabel).join(', ') || 'Manage packages'}
                          aria-label={`Manage packages for ${op.client_name}`}
                        >
                          <Package size={14} /> {getOperatorPackageNames(op).length}
                        </button>
                      </td>
                      <td className="operators-notes-cell" title={op.notes || ''}>
                        {op.notes ? (op.notes.length > 40 ? `${op.notes.slice(0, 40)}…` : op.notes) : '—'}
                      </td>
                      <td className="operators-email-cell" title={op.email}>{op.email}</td>
                      <td>{formatMoney(op.wallet_balance, 'MVR')}</td>
                      <td style={{ fontSize: 13 }}>{formatCommissionLabel(op)}</td>
                      <td>{op.accounts_created.toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setTrialModal(op)}
                          disabled={!canAdjustWallet}
                          title="Free accounts remaining / granted"
                          aria-label={`Manage free accounts for ${op.client_name}`}
                        >
                          <Gift size={14} />{' '}
                          {Math.max(0, (Number(op.trial_account_limit) || 0) - (Number(op.trial_accounts_used) || 0))}
                          {' / '}
                          {Number(op.trial_account_limit) || 0}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setUsersModal(op)}
                          title="Manage users"
                        >
                          <UserCog size={14} /> {Number(op.active_user_count) || 0}
                          {Number(op.user_count) > Number(op.active_user_count)
                            ? ` / ${op.user_count}`
                            : ''}
                        </button>
                      </td>
                      <td><StatusBadge active={op.is_active} /></td>
                      <td>{formatDate(op.created_at)}</td>
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
                              onClick={() => { setUsersModal(op); setMenuOpen(null); }}
                            >
                              <UserCog size={16} /> Manage Users
                            </button>
                            <button
                              className="header-dropdown-item"
                              onClick={() => { setPackagesModal(op); setMenuOpen(null); }}
                            >
                              <Package size={16} /> Manage Packages
                            </button>
                            {canAdjustWallet && (
                              <button
                                className="header-dropdown-item"
                                onClick={() => { setTrialModal(op); setMenuOpen(null); }}
                              >
                                <Gift size={16} /> Free Accounts
                              </button>
                            )}
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

      <OperatorPackagesModal
        operator={packagesModal}
        packages={packages}
        groups={packageGroups}
        canCreatePackage={canCreatePackage}
        onClose={() => setPackagesModal(null)}
        onChanged={loadOperators}
      />

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
              disabled={submitting || (!packages.length && !packageGroups.length)}
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
              disabled={submitting || (!packages.length && !packageGroups.length)}
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

      <OperatorTrialQuotaModal
        operator={trialModal}
        onClose={() => setTrialModal(null)}
        onChanged={loadOperators}
      />

      <OperatorUsersModal
        operator={usersModal}
        onClose={() => setUsersModal(null)}
        onChanged={loadOperators}
      />

      <Modal
        open={!!issuedKey}
        onClose={() => setIssuedKey(null)}
        title="Operator API key"
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={copyIssuedKey}>
              <Copy size={16} /> Copy key
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setIssuedKey(null)}>
              I have saved it
            </button>
          </>
        )}
      >
        {issuedKey && (
          <>
            <div className="alert alert-error">
              Copy this key now. It is not stored in readable form and cannot be shown again.
            </div>
            <p style={{ marginBottom: 8 }}>
              API key for <strong>{issuedKey.clientName}</strong> ({issuedKey.name}):
            </p>
            <code style={{ display: 'block', padding: 12, wordBreak: 'break-all', userSelect: 'all' }}>
              {issuedKey.apiKey}
            </code>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={!!revokeKeyTarget}
        onClose={() => setRevokeKeyTarget(null)}
        onConfirm={confirmRevokeApiKey}
        title="Revoke API key?"
        message={`Revoke "${revokeKeyTarget?.name}" (${revokeKeyTarget?.keyPrefix}_…)? Anything using this key will stop working. This cannot be undone.`}
        confirmLabel="Revoke"
        variant="danger"
        loading={apiKeyBusy}
      />

      <ConfirmModal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmToggleStatus}
        title={confirmTarget?.is_active ? 'Deactivate operator?' : 'Activate operator?'}
        message={
          confirmTarget?.is_active
            ? `Are you sure you want to deactivate ${confirmTarget.client_name}? All of its users will be signed out and will no longer be able to log in or create accounts.`
            : `Activate ${confirmTarget?.client_name}? They will regain access to the portal.`
        }
        confirmLabel={confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
        variant={confirmTarget?.is_active ? 'danger' : 'primary'}
        loading={confirmLoading}
      />
    </div>
  );
}
