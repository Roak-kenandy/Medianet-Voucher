import { useState, useEffect } from 'react';
import { Plus, Package, RefreshCw, Power, Layers, Pencil } from 'lucide-react';
import Modal from '../../components/Modal';
import PackageGroupsModal from '../../components/admin/PackageGroupsModal';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';
import { getServiceTypes, getServiceTagLabel } from '../../constants/serviceTags';
import './admin-shared.css';

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const emptyEligibility = () => ({
  packageRole: 'standalone',
  upgradeFamily: '',
  upgradeTier: '',
  requiredPackageIds: [],
});

/** Only the fields that belong to the chosen role are sent. */
function eligibilityPayload(form) {
  return {
    packageRole: form.packageRole,
    upgradeFamily: form.packageRole === 'base' ? form.upgradeFamily.trim() : null,
    upgradeTier: form.packageRole === 'base' ? Number(form.upgradeTier) : null,
    requiredPackageIds: form.packageRole === 'addon' ? form.requiredPackageIds : [],
  };
}

function RoleSummary({ pkg }) {
  const role = pkg.package_role || 'standalone';
  if (role === 'base') {
    return (
      <>
        <span className="badge badge-info">Base</span>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {pkg.upgrade_family} · tier {pkg.upgrade_tier}
        </div>
      </>
    );
  }
  if (role === 'addon') {
    const count = (pkg.required_package_ids || []).length;
    return (
      <>
        <span className="badge badge-warning">Add-on</span>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          with {count} base {count === 1 ? 'package' : 'packages'}
        </div>
      </>
    );
  }
  return <span className="badge">Standalone</span>;
}

/**
 * Selling rules for a package: whether it is a main plan that customers upgrade through,
 * an add-on that needs a main plan, or something sold on its own.
 */
function EligibilityFields({ form, onChange, basePackages, families, packageId }) {
  const set = (patch) => onChange({ ...form, ...patch });
  const choices = basePackages.filter(
    (pkg) => pkg.id !== packageId && pkg.serviceTag === form.serviceTag
  );
  const toggleRequired = (id) =>
    set({
      requiredPackageIds: form.requiredPackageIds.includes(id)
        ? form.requiredPackageIds.filter((item) => item !== id)
        : [...form.requiredPackageIds, id],
    });

  return (
    <>
      <div className="form-group form-group-full">
        <label className="form-label">Package Role</label>
        <select
          className="form-input"
          value={form.packageRole}
          onChange={(e) => set({ packageRole: e.target.value })}
        >
          <option value="standalone">Standalone — can always be sold</option>
          <option value="base">Base — a main plan customers can upgrade from</option>
          <option value="addon">Add-on — only with certain base packages</option>
        </select>
      </div>
      {form.packageRole === 'base' && (
        <>
          <div className="form-group">
            <label className="form-label">Upgrade Family</label>
            <input
              className="form-input"
              list="package-upgrade-families"
              value={form.upgradeFamily}
              onChange={(e) => set({ upgradeFamily: e.target.value })}
              placeholder="e.g. OTT plans"
              maxLength={60}
              required
            />
            <datalist id="package-upgrade-families">
              {families.map((family) => (
                <option key={family} value={family} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label className="form-label">Tier</label>
            <input
              type="number"
              className="form-input"
              value={form.upgradeTier}
              onChange={(e) => set({ upgradeTier: e.target.value })}
              min={1}
              step={1}
              placeholder="1 = lowest"
              required
            />
          </div>
          <p className="form-hint form-group-full">
            Customers on a base package can only move to a higher tier in the same family. Lower tiers
            and other families are not offered.
          </p>
        </>
      )}
      {form.packageRole === 'addon' && (
        <div className="form-group form-group-full">
          <label className="form-label">Can be sold with</label>
          {choices.length === 0 ? (
            <p className="form-hint">
              No base packages for this customer type yet. Set a package to Base first.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
              {choices.map((pkg) => (
                <label key={pkg.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.requiredPackageIds.includes(pkg.id)}
                    onChange={() => toggleRequired(pkg.id)}
                  />
                  {pkg.name}
                </label>
              ))}
            </div>
          )}
          <p className="form-hint">
            The customer must have one of these (or buy it at the same time). On an upgrade to a base
            package that is not ticked here, this add-on is cancelled.
          </p>
        </div>
      )}
    </>
  );
}

const emptyForm = () => ({
  name: '',
  serviceTag: 'OTT',
  salesModelId: '',
  sku: '',
  productId: '',
  priceTermId: '',
  priceAmount: '',
  currencyCode: 'MVR',
  description: '',
  ...emptyEligibility(),
});

export default function PackagesTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [packages, setPackages] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [crmLoading, setCrmLoading] = useState(false);
  const [catalogServiceTag, setCatalogServiceTag] = useState('OTT');
  const [recommendations, setRecommendations] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    serviceTag: 'OTT',
    salesModelId: '',
    sku: '',
    description: '',
    productId: '',
    priceTermId: '',
    priceAmount: '',
    currencyCode: 'MVR',
    ...emptyEligibility(),
  });
  const [editError, setEditError] = useState('');
  const [basePackages, setBasePackages] = useState([]);
  const [families, setFamilies] = useState([]);

  // Base packages (for the add-on picker) and the family names already in use.
  const loadEligibilityChoices = () =>
    adminApi
      .getPackages()
      .then((all) => {
        const bases = all.filter((pkg) => pkg.packageRole === 'base');
        setBasePackages(bases);
        setFamilies([...new Set(bases.map((pkg) => pkg.upgradeFamily).filter(Boolean))].sort());
      })
      .catch(() => {});

  const openEdit = (pkg) => {
    setEditForm({
      name: pkg.name,
      serviceTag: pkg.service_tag || 'OTT',
      salesModelId: pkg.sales_model_id ?? '',
      sku: pkg.sku || '',
      description: pkg.description || '',
      productId: pkg.product_id || '',
      priceTermId: pkg.price_term_id || '',
      priceAmount: pkg.price_amount ?? '',
      currencyCode: pkg.currency_code || 'MVR',
      packageRole: pkg.package_role || 'standalone',
      upgradeFamily: pkg.upgrade_family || '',
      upgradeTier: pkg.upgrade_tier ?? '',
      requiredPackageIds: pkg.required_package_ids || [],
    });
    setEditError('');
    setEditTarget(pkg);
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    setSubmitting(true);
    try {
      await adminApi.updatePackage(editTarget.id, {
        ...editForm,
        salesModelId: Number(editForm.salesModelId),
        priceAmount: Number(editForm.priceAmount),
        ...eligibilityPayload(editForm),
      });
      setEditTarget(null);
      toast.success('Package updated');
      loadPackages();
      loadEligibilityChoices();
    } catch (err) {
      setEditError(err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || 'Failed to update package');
    } finally {
      setSubmitting(false);
    }
  };
  const [salesModels, setSalesModels] = useState([]);
  const [catalogSalesModelId, setCatalogSalesModelId] = useState('');
  const serviceTypeOptions = getServiceTypes({ activeOnly: true });

  useEffect(() => {
    adminApi
      .getSalesModels()
      .then((models) => {
        const active = models.filter((model) => model.isActive);
        setSalesModels(active);
        setCatalogSalesModelId((current) => current || (active[0]?.id ?? ''));
      })
      .catch(() => setSalesModels([]));
  }, []);

  const loadPackages = () => {
    setLoading(true);
    adminApi
      .getPackagesList({ page, limit: 20, search })
      .then((result) => {
        setPackages(result.packages);
        setPagination(result.pagination);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPackages();
  }, [page, search]);

  useEffect(() => {
    loadEligibilityChoices();
  }, []);

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetForm = () => {
    setForm(emptyForm());
    setRecommendations([]);
    setError('');
  };

  const loadCrmCatalog = async (serviceTag = catalogServiceTag) => {
    if (!catalogSalesModelId) {
      setError('Select a sales model first');
      return;
    }
    setCrmLoading(true);
    setError('');
    try {
      const items = await adminApi.getCrmRecommendations(serviceTag, catalogSalesModelId);
      setRecommendations(items);
      setForm((prev) => ({
        ...prev,
        serviceTag,
        salesModelId: Number(catalogSalesModelId),
        productId: '',
        priceTermId: '',
        priceAmount: '',
      }));
      if (!items.length) {
        toast.warning(`No packages returned for ${getServiceTagLabel(serviceTag)}`);
      }
    } catch (err) {
      setError(err.message || 'Failed to load service catalog');
      toast.error(err.message || 'Failed to load service catalog');
    } finally {
      setCrmLoading(false);
    }
  };

  const handleServiceChange = (productId) => {
    const service = recommendations.find((item) => item.productId === productId);
    if (!service) return;

    const defaultPrice = service.prices.find((p) => p.isDefault) || service.prices[0];

    setForm((prev) => ({
      ...prev,
      productId,
      name: prev.name || service.name,
      sku: service.sku || '',
      priceTermId: defaultPrice?.priceTermId || '',
      priceAmount: defaultPrice?.price ?? '',
      currencyCode: defaultPrice?.currencyCode || 'MVR',
    }));
  };

  const handlePriceChange = (priceTermId) => {
    const service = recommendations.find((item) => item.productId === form.productId);
    const price = service?.prices.find((p) => p.priceTermId === priceTermId);
    if (!price) return;

    setForm((prev) => ({
      ...prev,
      priceTermId,
      priceAmount: price.price,
      currencyCode: price.currencyCode || 'MVR',
    }));
  };

  const selectedService = recommendations.find((item) => item.productId === form.productId);
  const priceOptions = selectedService?.prices || [];

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await adminApi.createPackage({
        ...form,
        priceAmount: Number(form.priceAmount),
        ...eligibilityPayload(form),
      });
      setModalOpen(false);
      resetForm();
      toast.success('Package created successfully');
      loadPackages();
      loadEligibilityChoices();
    } catch (err) {
      setError(err.message || 'Failed to create package');
      if (err.errors) {
        setError(err.errors.map((item) => item.message).join('. '));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (pkg) => {
    try {
      await adminApi.updatePackageStatus(pkg.id, !pkg.is_active);
      toast.success(pkg.is_active ? `${pkg.name} deactivated` : `${pkg.name} activated`);
      loadPackages();
    } catch (err) {
      toast.error(err.message || 'Failed to update package');
    }
  };

  const canCreatePackage = hasPermission(user?.role, 'createPackage');
  const canManagePackageStatus = hasPermission(user?.role, 'managePackageStatus');
  const isReadOnly = !canCreatePackage && !canManagePackageStatus;

  return (
    <>
      {isReadOnly && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          You have view-only access to packages. Creating or changing packages requires Admin or Sales role.
        </div>
      )}
      <div className="tab-toolbar">
        <button className="btn btn-secondary" onClick={() => setGroupsOpen(true)}>
          <Layers size={18} />
          Package Groups
        </button>
        {canCreatePackage && (
        <button
          className="btn btn-primary"
          onClick={() => {
            resetForm();
            setModalOpen(true);
          }}
        >
          <Plus size={18} />
          Create Package
        </button>
        )}
      </div>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Package — ${editTarget?.name || ''}`}
        wide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-package-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        )}
      >
        {editError && <div className="alert alert-error">{editError}</div>}
        <form id="edit-package-form" onSubmit={handleEdit}>
          <div className="form-grid">
            <div className="form-group form-group-full">
              <label className="form-label">Package Name</label>
              <input
                className="form-input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Customer Type</label>
              <select
                className="form-input"
                value={editForm.serviceTag}
                onChange={(e) => setEditForm({ ...editForm, serviceTag: e.target.value })}
              >
                {!serviceTypeOptions.some((type) => type.key === editForm.serviceTag) && (
                  <option value={editForm.serviceTag}>{getServiceTagLabel(editForm.serviceTag)} (inactive)</option>
                )}
                {serviceTypeOptions.map((type) => (
                  <option key={type.key} value={type.key}>{type.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Sales Model</label>
              <select
                className="form-input"
                value={editForm.salesModelId}
                onChange={(e) => setEditForm({ ...editForm, salesModelId: e.target.value })}
                required
              >
                <option value="">Select a sales model</option>
                {editTarget?.sales_model_id != null &&
                  !salesModels.some((model) => model.id === editTarget.sales_model_id) && (
                    <option value={editTarget.sales_model_id}>{editTarget.sales_model_name} (inactive)</option>
                  )}
                {salesModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">SKU (optional)</label>
              <input
                className="form-input"
                value={editForm.sku}
                onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                maxLength={100}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Price ({editForm.currencyCode})</label>
              <input
                type="number"
                className="form-input"
                value={editForm.priceAmount}
                onChange={(e) => setEditForm({ ...editForm, priceAmount: e.target.value })}
                min={0}
                step="0.01"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">CRM Product ID</label>
              <input
                className="form-input"
                value={editForm.productId}
                onChange={(e) => setEditForm({ ...editForm, productId: e.target.value.trim() })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">CRM Price Term ID</label>
              <input
                className="form-input"
                value={editForm.priceTermId}
                onChange={(e) => setEditForm({ ...editForm, priceTermId: e.target.value.trim() })}
                required
              />
            </div>
            <EligibilityFields
              form={editForm}
              onChange={setEditForm}
              basePackages={basePackages}
              families={families}
              packageId={editTarget?.id}
            />
            <div className="form-group form-group-full">
              <label className="form-label">Description (optional)</label>
              <textarea
                className="form-input"
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                maxLength={1000}
              />
            </div>
          </div>
          <p className="form-hint">
            The price is what operators are charged and what is posted to CRM as the payment, and the
            product and price term are what CRM subscribes the customer to. Keep all three in line with
            CRM; changes apply to sales made from now on. Changing the customer type or sales model changes
            which operators can sell this package: it disappears for operators not allowed the new one.
          </p>
        </form>
      </Modal>

      <PackageGroupsModal open={groupsOpen} canManage={canCreatePackage} onClose={() => setGroupsOpen(false)} />

      <div className="card">
        <TableToolbar
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name, SKU, or product ID..."
        />
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 200 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : packages.length === 0 ? (
            <div className="empty-state">
              <Package className="empty-state-icon" size={48} />
              <p className="empty-state-title">
                {search ? 'No packages match your search' : 'No packages yet'}
              </p>
              <p>{search ? 'Try a different search term' : (canCreatePackage ? 'Create packages from the service catalog to assign them to operators' : 'View packages assigned to operators')}</p>
              {!search && canCreatePackage && (
                <div className="empty-state-action">
                  <button className="btn btn-primary" onClick={() => { resetForm(); setModalOpen(true); }}>
                    <Plus size={18} />
                    Create Package
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Service</th>
                      <th>Sales model</th>
                      <th>Role</th>
                      <th>SKU</th>
                      <th>Price</th>
                      <th>Product ID</th>
                      <th>Price Term ID</th>
                      <th>Status</th>
                      {(canManagePackageStatus || canCreatePackage) && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td style={{ fontWeight: 500 }}>{pkg.name}</td>
                        <td><span className="badge badge-info">{getServiceTagLabel(pkg.service_tag || 'OTT')}</span></td>
                        <td>{pkg.sales_model_name || '—'}</td>
                        <td><RoleSummary pkg={pkg} /></td>
                        <td>{pkg.sku || '—'}</td>
                        <td>{Number(pkg.price_amount).toLocaleString()} {pkg.currency_code}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{pkg.product_id}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{pkg.price_term_id}</td>
                        <td><StatusBadge active={pkg.is_active} /></td>
                        {(canManagePackageStatus || canCreatePackage) && (
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {canCreatePackage && (
                              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(pkg)}>
                                <Pencil size={14} />
                                Edit
                              </button>
                            )}
                            {canManagePackageStatus && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => toggleStatus(pkg)}
                              >
                                <Power size={14} />
                                {pkg.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                            )}
                          </div>
                        </td>
                        )}
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
                itemLabel="packages"
              />
            </>
          )}
        </div>
      </div>

      {canCreatePackage && (
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create Package"
        extraWide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="create-package-form"
              className="btn btn-primary"
              disabled={submitting || !form.productId || !form.priceTermId}
            >
              {submitting ? 'Creating...' : 'Create Package'}
            </button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ marginBottom: 20 }}>
          <div className="form-group">
            <label className="form-label">Package Tag</label>
            <select
              className="form-input"
              value={catalogServiceTag}
              onChange={(e) => {
                setCatalogServiceTag(e.target.value);
                setRecommendations([]);
                setForm((prev) => ({ ...prev, serviceTag: e.target.value, productId: '', priceTermId: '' }));
              }}
            >
              {serviceTypeOptions.map((tag) => (
                <option key={tag.key} value={tag.key}>{tag.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Sales Model</label>
            <select
              className="form-input"
              value={catalogSalesModelId}
              onChange={(e) => {
                setCatalogSalesModelId(e.target.value);
                setRecommendations([]);
                setForm((prev) => ({ ...prev, salesModelId: '', productId: '', priceTermId: '' }));
              }}
            >
              {!salesModels.length && <option value="">No sales models configured</option>}
              {salesModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadCrmCatalog(catalogServiceTag)}
            disabled={crmLoading}
          >
            <RefreshCw size={16} />
            {crmLoading ? 'Loading catalog...' : 'Load catalog'}
          </button>
          <p className="form-hint" style={{ marginTop: 8 }}>
            Loads {getServiceTagLabel(catalogServiceTag)} products with prices from the{' '}
            {salesModels.find((model) => String(model.id) === String(catalogSalesModelId))?.name || 'selected'}{' '}
            sales model. The package is saved under that customer type and sales model.
          </p>
        </div>

        <form id="create-package-form" onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-group form-group-full">
              <label className="form-label">Service</label>
              <select
                className="form-input"
                value={form.productId}
                onChange={(e) => handleServiceChange(e.target.value)}
                required
                disabled={!recommendations.length}
              >
                <option value="">
                  {recommendations.length ? 'Select a service' : 'Load catalog first'}
                </option>
                {recommendations.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.name} {item.sku ? `(${item.sku})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Price Tier</label>
              <select
                className="form-input"
                value={form.priceTermId}
                onChange={(e) => handlePriceChange(e.target.value)}
                required
                disabled={!priceOptions.length}
              >
                <option value="">Select price tier</option>
                {priceOptions.map((price) => (
                  <option key={price.priceTermId} value={price.priceTermId}>
                    {price.price} {price.currencyCode}
                    {price.salesModelName ? ` · ${price.salesModelName}` : ''}
                    {price.label ? ` · ${price.label}` : ''}
                    {price.segmentName ? ` · ${price.segmentName}` : ''}
                    {price.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. BAISKOAFU OTT"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">SKU</label>
              <input
                className="form-input"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Optional"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Price Amount</label>
              <input
                type="number"
                className="form-input"
                value={form.priceAmount}
                onChange={(e) => setForm({ ...form, priceAmount: e.target.value })}
                min={0}
                step="any"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Currency</label>
              <input
                className="form-input"
                value={form.currencyCode}
                onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })}
                maxLength={3}
                required
              />
            </div>

            <EligibilityFields form={form} onChange={setForm} basePackages={basePackages} families={families} />

            <div className="form-group form-group-full">
              <label className="form-label">Notes / Description</label>
              <textarea
                className="form-input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Internal notes about this package (optional)"
                rows={3}
              />
            </div>
          </div>
        </form>
      </Modal>
      )}
    </>
  );
}
