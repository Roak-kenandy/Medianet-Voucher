import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Pencil } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import Modal from '../../components/Modal';
import { adminApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { hasPermission } from '../../constants/permissions';
import { setServiceTypes } from '../../constants/serviceTags';
import { setAppSettings } from '../../constants/appSettings';
import './admin-shared.css';

const emptyTypeForm = () => ({
  key: '',
  label: '',
  shortLabel: '',
  crmTagName: '',
  crmTagId: '',
  crmDeviceProductId: '',
  crmPriceSegmentName: '',
  isActive: true,
});

const emptyModelForm = () => ({ name: '', description: '', isActive: true });

/** Every IANA time zone the browser knows, with a short fallback list for older browsers. */
function listTimeZones(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Indian/Maldives', 'UTC', 'Asia/Colombo', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore'];
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

function StatusBadge({ active }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-danger'}`}>{active ? 'Active' : 'Inactive'}</span>
  );
}

function errorText(err, fallback) {
  return err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || fallback;
}

/**
 * Customer types (CRM tag, device product, price segment) and CRM sales models. Operators are
 * then allowed specific types and sales models from the Operators page.
 */
export default function CrmSettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  // { kind: 'type' | 'model', target: row | null }
  const [modal, setModal] = useState(null);
  const [typeForm, setTypeForm] = useState(emptyTypeForm());
  const [modelForm, setModelForm] = useState(emptyModelForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [general, setGeneral] = useState(null);
  const [generalForm, setGeneralForm] = useState({ timeZone: '', gstRatePercent: '', tinNumber: '', currencyCode: 'MVR' });
  const [generalError, setGeneralError] = useState('');
  const [generalSaving, setGeneralSaving] = useState(false);

  const applyGeneral = (data) => {
    setGeneral(data);
    setGeneralForm({
      timeZone: data.timeZone,
      gstRatePercent: data.gstRatePercent,
      tinNumber: data.tinNumber || '',
      currencyCode: data.currencyCode,
    });
    setAppSettings(data);
  };

  const handleGeneralSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');
    setGeneralSaving(true);
    try {
      applyGeneral(await adminApi.updateAppSettings({ ...generalForm, gstRatePercent: Number(generalForm.gstRatePercent) }));
      toast.success('Settings saved');
    } catch (err) {
      setGeneralError(errorText(err, 'Failed to save settings'));
    } finally {
      setGeneralSaving(false);
    }
  };

  const allowed = hasPermission(user?.role, 'manageCrmSettings');

  const load = () => {
    setLoading(true);
    Promise.all([adminApi.getServiceTypes(), adminApi.getSalesModels(), adminApi.getAppSettings()])
      .then(([typeList, modelList, generalSettings]) => {
        applyGeneral(generalSettings);
        setTypes(typeList);
        setModels(modelList);
        setServiceTypes(typeList);
      })
      .catch((err) => toast.error(err.message || 'Failed to load CRM settings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  if (!allowed) {
    return <Navigate to="/admin" replace />;
  }

  const openType = (target = null) => {
    setTypeForm(
      target
        ? {
            key: target.key,
            label: target.label,
            shortLabel: target.shortLabel,
            crmTagName: target.crmTagName,
            crmTagId: target.crmTagId || '',
            crmDeviceProductId: target.crmDeviceProductId || '',
            crmPriceSegmentName: target.crmPriceSegmentName || '',
            isActive: target.isActive,
          }
        : emptyTypeForm()
    );
    setError('');
    setModal({ kind: 'type', target });
  };

  const openModel = (target = null) => {
    setModelForm(
      target
        ? { name: target.name, description: target.description || '', isActive: target.isActive }
        : emptyModelForm()
    );
    setError('');
    setModal({ kind: 'model', target });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (modal.kind === 'type') {
        if (modal.target) {
          const { key: _key, ...payload } = typeForm;
          await adminApi.updateServiceType(modal.target.key, payload);
        } else {
          await adminApi.createServiceType(typeForm);
        }
        toast.success('Customer type saved');
      } else {
        if (modal.target) await adminApi.updateSalesModel(modal.target.id, modelForm);
        else await adminApi.createSalesModel(modelForm);
        toast.success('Sales model saved');
      }
      setModal(null);
      load();
    } catch (err) {
      setError(errorText(err, 'Failed to save'));
    } finally {
      setSubmitting(false);
    }
  };

  const editingType = modal?.kind === 'type' ? modal.target : null;

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">System Settings</h1>
        <p className="page-subtitle">
          General settings, plus the customer types and sales models used for CRM lookups and package pricing
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <h2 className="page-title" style={{ fontSize: 18 }}>General</h2>
          {generalError && <div className="alert alert-error">{generalError}</div>}
          {general && (
            <form onSubmit={handleGeneralSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Time zone</label>
                  <select
                    className="form-input"
                    value={generalForm.timeZone}
                    onChange={(e) => setGeneralForm({ ...generalForm, timeZone: e.target.value })}
                    required
                  >
                    {listTimeZones(generalForm.timeZone).map((zone) => (
                      <option key={zone} value={zone}>{zone}</option>
                    ))}
                  </select>
                  <p className="form-hint">Dates and times across the portal and on bills are shown in this zone.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">GST rate (%)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={generalForm.gstRatePercent}
                    onChange={(e) => setGeneralForm({ ...generalForm, gstRatePercent: e.target.value })}
                    min={0}
                    max={100}
                    step="0.01"
                    required
                  />
                  <p className="form-hint">
                    Taken out of wallet top-ups from now on. Top-ups already started or completed keep the
                    rate they were made with.
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">TIN number</label>
                  <input
                    className="form-input"
                    value={generalForm.tinNumber}
                    onChange={(e) => setGeneralForm({ ...generalForm, tinNumber: e.target.value })}
                    maxLength={50}
                    placeholder="Tax identification number"
                  />
                  <p className="form-hint">Printed on wallet top-up bills. Leave empty to hide it.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select
                    className="form-input"
                    value={generalForm.currencyCode}
                    onChange={(e) => setGeneralForm({ ...generalForm, currencyCode: e.target.value })}
                  >
                    {(general.supportedCurrencies || ['MVR']).map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                  <p className="form-hint">Wallets, bank payments and CRM amounts all use this currency.</p>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={generalSaving}>
                {generalSaving ? 'Saving...' : 'Save General Settings'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="page-header-row">
            <div>
              <h2 className="page-title" style={{ fontSize: 18 }}>Customer types</h2>
              <p className="form-hint" style={{ marginTop: 4 }}>
                Each type has its own CRM tag, device product and price segment. An operator only sees CRM
                contacts carrying the tag of a type it is allowed, and new customers get that tag.
              </p>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn btn-primary" onClick={() => openType()}>
                <Plus size={18} /> Add Customer Type
              </button>
            </div>
          </div>
          {loading ? (
            <div className="loading-screen" style={{ height: 120 }}>
              <div className="spinner spinner-lg" />
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Key</th>
                    <th>CRM tag</th>
                    <th>Device product</th>
                    <th>Price segment</th>
                    <th>Used by</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <tr key={type.key}>
                      <td style={{ fontWeight: 500 }}>
                        {type.label}
                        <span className="form-hint" style={{ display: 'block', margin: 0 }}>{type.shortLabel}</span>
                      </td>
                      <td><code>{type.key}</code></td>
                      <td>
                        {type.crmTagName}
                        <span className="form-hint" style={{ display: 'block', margin: 0 }}>
                          {type.effectiveCrmTagId || 'Tag id not set'}
                          {type.usesEnvTagId ? ' (from .env)' : ''}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {type.effectiveCrmDeviceProductId || 'Not set'}
                        {type.usesEnvDeviceProductId ? ' (from .env)' : ''}
                      </td>
                      <td>{type.crmPriceSegmentName || 'Any'}</td>
                      <td>{type.operatorCount} operator(s), {type.packageCount} package(s)</td>
                      <td><StatusBadge active={type.isActive} /></td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openType(type)}>
                          <Pencil size={14} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="page-header-row">
            <div>
              <h2 className="page-title" style={{ fontSize: 18 }}>Sales models</h2>
              <p className="form-hint" style={{ marginTop: 4 }}>
                A package belongs to one sales model (its CRM price tier). An operator can only be given
                packages from the sales models it is allowed.
              </p>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn btn-primary" onClick={() => openModel()}>
                <Plus size={18} /> Add Sales Model
              </button>
            </div>
          </div>
          {!loading && (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name in CRM</th>
                    <th>Description</th>
                    <th>Used by</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr key={model.id}>
                      <td style={{ fontWeight: 500 }}>{model.name}</td>
                      <td>{model.description || '—'}</td>
                      <td>{model.operatorCount} operator(s), {model.packageCount} package(s)</td>
                      <td><StatusBadge active={model.isActive} /></td>
                      <td>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openModel(model)}>
                          <Pencil size={14} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={
          modal?.kind === 'type'
            ? editingType ? `Edit Customer Type — ${editingType.label}` : 'Add Customer Type'
            : modal?.target ? `Edit Sales Model — ${modal.target.name}` : 'Add Sales Model'
        }
        wide
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="submit" form="crm-settings-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="crm-settings-form" onSubmit={handleSubmit}>
          {modal?.kind === 'type' && (
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Label</label>
                <input
                  className="form-input"
                  value={typeForm.label}
                  onChange={(e) => setTypeForm({ ...typeForm, label: e.target.value })}
                  placeholder="e.g. Hotel TV"
                  required
                  maxLength={120}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Short label</label>
                <input
                  className="form-input"
                  value={typeForm.shortLabel}
                  onChange={(e) => setTypeForm({ ...typeForm, shortLabel: e.target.value })}
                  placeholder="e.g. Hotel"
                  required
                  maxLength={40}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Key</label>
                <input
                  className="form-input"
                  value={typeForm.key}
                  onChange={(e) => setTypeForm({ ...typeForm, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                  placeholder="e.g. HOTEL_TV"
                  required
                  disabled={!!editingType}
                  maxLength={40}
                />
                <p className="form-hint">
                  Internal identifier stored on packages and accounts. It cannot be changed later.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">CRM tag name</label>
                <input
                  className="form-input"
                  value={typeForm.crmTagName}
                  onChange={(e) => setTypeForm({ ...typeForm, crmTagName: e.target.value })}
                  placeholder="Exactly as named in CRM"
                  required
                  maxLength={120}
                />
                <p className="form-hint">Used to find this type's products and to recognise its contacts.</p>
              </div>
              <div className="form-group">
                <label className="form-label">CRM tag id</label>
                <input
                  className="form-input"
                  value={typeForm.crmTagId}
                  onChange={(e) => setTypeForm({ ...typeForm, crmTagId: e.target.value.trim() })}
                  placeholder={editingType?.usesEnvTagId ? 'Leave empty to keep the .env value' : 'CRM tag UUID'}
                  required={!editingType?.effectiveCrmTagId}
                />
                <p className="form-hint">Added to new customers of this type.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Device product id</label>
                <input
                  className="form-input"
                  value={typeForm.crmDeviceProductId}
                  onChange={(e) => setTypeForm({ ...typeForm, crmDeviceProductId: e.target.value.trim() })}
                  placeholder={editingType?.usesEnvDeviceProductId ? 'Leave empty to keep the .env value' : 'CRM product UUID'}
                  required={!editingType?.effectiveCrmDeviceProductId}
                />
                <p className="form-hint">The device created for a new customer of this type.</p>
              </div>
              <div className="form-group">
                <label className="form-label">Price segment name (optional)</label>
                <input
                  className="form-input"
                  value={typeForm.crmPriceSegmentName}
                  onChange={(e) => setTypeForm({ ...typeForm, crmPriceSegmentName: e.target.value })}
                  placeholder="Leave empty for any segment"
                  maxLength={120}
                />
                <p className="form-hint">Only CRM prices in this segment are offered when creating packages.</p>
              </div>
              {editingType && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-input"
                    value={typeForm.isActive ? 'active' : 'inactive'}
                    onChange={(e) => setTypeForm({ ...typeForm, isActive: e.target.value === 'active' })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <p className="form-hint">
                    An inactive type cannot be used for lookups, new accounts or new packages. Existing
                    records keep their type.
                  </p>
                </div>
              )}
            </div>
          )}
          {modal?.kind === 'model' && (
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Name in CRM</label>
                <input
                  className="form-input"
                  value={modelForm.name}
                  onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                  placeholder="e.g. Retail"
                  required
                  maxLength={120}
                />
                <p className="form-hint">
                  Must match the sales model name in CRM exactly; the package catalog is filtered by it.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <input
                  className="form-input"
                  value={modelForm.description}
                  onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })}
                  maxLength={500}
                />
              </div>
              {modal.target && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-input"
                    value={modelForm.isActive ? 'active' : 'inactive'}
                    onChange={(e) => setModelForm({ ...modelForm, isActive: e.target.value === 'active' })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <p className="form-hint">
                    An inactive sales model cannot be chosen for new packages or operators. Operators that
                    already have it keep selling its packages.
                  </p>
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>
    </Layout>
  );
}
