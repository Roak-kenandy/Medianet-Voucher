import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../Modal';
import PackageSelector from './PackageSelector';
import PackageGroupPicker from './PackageGroupPicker';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { getServiceScopeLabel, packageMatchesScope, packageMatchesSalesModels } from '../../constants/serviceTags';

const sameIds = (a, b) => {
  const left = [...a].map(Number).sort((x, y) => x - y);
  const right = [...b].map(Number).sort((x, y) => x - y);
  return left.length === right.length && left.every((id, index) => id === right[index]);
};

/**
 * Staff-side management of what one operator may sell: package groups it shares with other
 * operators, plus packages assigned to it individually.
 */
export default function OperatorPackagesModal({ operator, packages, groups, canCreatePackage, onClose, onChanged }) {
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const operatorId = operator?.id;
  const serviceScope = operator?.service_type_keys || [];
  const salesModelIds = operator?.sales_model_ids || [];
  const salesModelNames = (operator?.sales_models || []).map((model) => model.name).join(', ');
  const currentDirectIds = operator?.direct_package_ids || [];
  const currentGroupIds = operator?.package_group_ids || [];

  // Only active packages that fit the operator's customer types can be assigned individually.
  const assignable = useMemo(
    () =>
      packages.filter(
        (pkg) => packageMatchesScope(pkg, serviceScope) && packageMatchesSalesModels(pkg, salesModelIds)
      ),
    [packages, operatorId]
  );
  const assignableIds = useMemo(() => new Set(assignable.map((pkg) => Number(pkg.id))), [assignable]);
  const unavailable = (operator?.packages || []).filter(
    (pkg) => pkg.direct && !assignableIds.has(Number(pkg.id))
  );

  useEffect(() => {
    setError('');
    setSelectedIds((operator?.direct_package_ids || []).map(Number).filter((id) => assignableIds.has(id)));
    setSelectedGroupIds((operator?.package_group_ids || []).map(Number));
  }, [operatorId, assignableIds]);

  // What the operator will be able to sell after saving.
  const effective = useMemo(() => {
    const byId = new Map();
    for (const pkg of assignable) {
      if (selectedIds.includes(Number(pkg.id))) {
        byId.set(Number(pkg.id), { name: pkg.label || pkg.name, sources: ['Individual'] });
      }
    }
    for (const group of groups) {
      if (!selectedGroupIds.includes(Number(group.id))) continue;
      for (const pkg of group.packages) {
        if (
          !pkg.isActive ||
          !packageMatchesScope(pkg, serviceScope) ||
          !packageMatchesSalesModels(pkg, salesModelIds)
        ) {
          continue;
        }
        const entry = byId.get(Number(pkg.id)) || { name: pkg.name, sources: [] };
        entry.sources.push(group.name);
        byId.set(Number(pkg.id), entry);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [assignable, groups, selectedIds, selectedGroupIds, operatorId]);

  const unchanged = sameIds(selectedIds, currentDirectIds) && sameIds(selectedGroupIds, currentGroupIds);

  const handleSave = async () => {
    setError('');
    if (!selectedIds.length && !selectedGroupIds.length) {
      setError('Select at least one package or package group');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.updateOperatorPackages(operatorId, {
        packageIds: selectedIds,
        packageGroupIds: selectedGroupIds,
      });
      toast.success(`Packages updated for ${operator.client_name}`);
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || 'Failed to update packages');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!operator}
      onClose={onClose}
      title={`Packages — ${operator?.client_name || ''}`}
      wide
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={submitting || unchanged}>
            {submitting ? 'Saving...' : 'Save Packages'}
          </button>
        </>
      )}
    >
      {error && <div className="alert alert-error">{error}</div>}

      <p className="form-hint" style={{ marginTop: 0 }}>
        This operator sells to <strong>{getServiceScopeLabel(serviceScope)}</strong> customers under the{' '}
        <strong>{salesModelNames || 'no'}</strong> sales model(s); only matching packages are offered. It
        gets the packages of every group ticked below, plus any assigned to it individually. Change its
        customer types and sales models in Edit Operator.
      </p>

      <label className="form-label">Package groups (shared with other operators)</label>
      <PackageGroupPicker
        groups={groups}
        selectedIds={selectedGroupIds}
        onChange={setSelectedGroupIds}
        serviceScope={serviceScope}
        salesModelIds={salesModelIds}
        disabled={submitting}
      />
      <p className="form-hint">
        When a group's packages change, every operator in that group changes with it.
      </p>

      <label className="form-label" style={{ marginTop: 16, display: 'block' }}>
        Individual packages (this operator only)
      </label>
      {!assignable.length ? (
        <p className="form-hint">
          No active packages match this operator's customer types and sales models.{' '}
          {canCreatePackage ? <Link to="/admin/packages">Create a package</Link> : 'Ask an Admin or Sales user to create a package'}{' '}
          first.
        </p>
      ) : (
        <PackageSelector packages={assignable} selectedIds={selectedIds} onChange={setSelectedIds} disabled={submitting} />
      )}
      {unavailable.length > 0 && (
        <p className="form-hint">
          No longer available and removed when you save: {unavailable.map((pkg) => pkg.name).join(', ')}.
        </p>
      )}

      <label className="form-label" style={{ marginTop: 16, display: 'block' }}>
        What this operator can sell after saving ({effective.length})
      </label>
      {effective.length === 0 ? (
        <p className="form-hint">Nothing selected yet.</p>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Comes from</th>
              </tr>
            </thead>
            <tbody>
              {effective.map((pkg) => (
                <tr key={pkg.name}>
                  <td>{pkg.name}</td>
                  <td>
                    {pkg.sources.map((source) => (
                      <span key={source} className={`badge ${source === 'Individual' ? 'badge-neutral' : 'badge-info'}`} style={{ marginRight: 6 }}>
                        {source}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
