import { useState, useEffect } from 'react';
import { Plus, Package, RefreshCw, Power } from 'lucide-react';
import Modal from '../../components/Modal';
import TableToolbar from '../../components/TableToolbar';
import TablePagination from '../../components/TablePagination';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';
import './admin-shared.css';

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const emptyForm = () => ({
  name: '',
  sku: '',
  productId: '',
  priceTermId: '',
  priceAmount: '',
  currencyCode: 'MVR',
  description: '',
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
  const [recommendations, setRecommendations] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const resetForm = () => {
    setForm(emptyForm());
    setRecommendations([]);
    setError('');
  };

  const loadCrmCatalog = async () => {
    setCrmLoading(true);
    setError('');
    try {
      const items = await adminApi.getCrmRecommendations();
      setRecommendations(items);
      if (!items.length) {
        toast.warning('No CRM packages returned');
      }
    } catch (err) {
      setError(err.message || 'Failed to load CRM catalog');
      toast.error(err.message || 'Failed to load CRM catalog');
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
      });
      setModalOpen(false);
      resetForm();
      toast.success('Package created successfully');
      loadPackages();
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
      {canCreatePackage && (
      <div className="tab-toolbar">
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
      </div>
      )}

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
              <p>{search ? 'Try a different search term' : (canCreatePackage ? 'Create packages from the CRM catalog to assign them to operators' : 'View packages assigned to operators')}</p>
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
                      <th>SKU</th>
                      <th>Price</th>
                      <th>CRM Product ID</th>
                      <th>Price Term ID</th>
                      <th>Status</th>
                      {canManagePackageStatus && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td style={{ fontWeight: 500 }}>{pkg.name}</td>
                        <td>{pkg.sku || '—'}</td>
                        <td>{Number(pkg.price_amount).toLocaleString()} {pkg.currency_code}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{pkg.product_id}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{pkg.price_term_id}</td>
                        <td><StatusBadge active={pkg.is_active} /></td>
                        {canManagePackageStatus && (
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => toggleStatus(pkg)}
                          >
                            <Power size={14} />
                            {pkg.is_active ? 'Deactivate' : 'Activate'}
                          </button>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadCrmCatalog}
            disabled={crmLoading}
          >
            <RefreshCw size={16} />
            {crmLoading ? 'Loading CRM catalog...' : 'Load from CRM'}
          </button>
          <p className="form-hint" style={{ marginTop: 8 }}>
            Loads all CRM products tagged <strong>OTT</strong> (paginated), then fetches price tiers where segment name is <strong>OTT</strong>. Product ID = service <code>id</code>; Price Term ID = <code>prices[].id</code> under the OTT segment.
          </p>
        </div>

        <form id="create-package-form" onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-group form-group-full">
              <label className="form-label">CRM Service</label>
              <select
                className="form-input"
                value={form.productId}
                onChange={(e) => handleServiceChange(e.target.value)}
                required
                disabled={!recommendations.length}
              >
                <option value="">
                  {recommendations.length ? 'Select a CRM service' : 'Load CRM catalog first'}
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
                step="0.01"
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
