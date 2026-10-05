import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import Modal from '../Modal';
import ConfirmModal from '../ConfirmModal';
import PackageSelector from './PackageSelector';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const emptyForm = () => ({ name: '', description: '', packageIds: [] });

/**
 * Package groups: named sets of packages shared by several operators. Editing a group's
 * packages changes every operator that has the group. `view` is 'list' or 'form'.
 */
export default function PackageGroupsModal({ open, canManage, onClose }) {
  const toast = useToast();
  const [groups, setGroups] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');
  const [target, setTarget] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([adminApi.getPackageGroups(), adminApi.getPackages()])
      .then(([groupList, packageList]) => {
        setGroups(groupList);
        setPackages(packageList);
      })
      .catch((err) => toast.error(err.message || 'Failed to load package groups'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setView('list');
    setTarget(null);
    setError('');
    load();
  }, [open]);

  const openForm = (group = null) => {
    setTarget(group);
    setForm(
      group
        ? { name: group.name, description: group.description || '', packageIds: group.packages.map((pkg) => pkg.id) }
        : emptyForm()
    );
    setError('');
    setView('form');
  };

  const backToList = () => {
    setView('list');
    setTarget(null);
    setError('');
  };

  // Packages already in the group stay selectable even if they were deactivated since.
  const selectablePackages = target
    ? [
        ...packages,
        ...target.packages
          .filter((pkg) => !packages.some((item) => Number(item.id) === Number(pkg.id)))
          .map((pkg) => ({ ...pkg, label: `${pkg.name} (inactive)` })),
      ]
    : packages;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (target) {
        await adminApi.updatePackageGroup(target.id, form);
        toast.success(
          target.operators.length
            ? `Group updated. ${target.operators.length} operator(s) now have the new packages.`
            : 'Group updated'
        );
      } else {
        await adminApi.createPackageGroup(form);
        toast.success('Package group created');
      }
      backToList();
      load();
    } catch (err) {
      setError(err.errors ? err.errors.map((item) => item.message).join('. ') : err.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    setSubmitting(true);
    try {
      await adminApi.deletePackageGroup(deleteTarget.id);
      toast.success('Package group deleted');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to delete package group');
    } finally {
      setSubmitting(false);
    }
  };

  const footer =
    view === 'list' ? (
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    ) : (
      <>
        <button type="button" className="btn btn-secondary" onClick={backToList}>
          <ArrowLeft size={16} /> Back to groups
        </button>
        <button type="submit" form="package-group-form" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Group'}
        </button>
      </>
    );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={view === 'list' ? 'Package Groups' : target ? `Edit Group — ${target.name}` : 'Create Package Group'}
        extraWide
        footer={footer}
      >
        {error && <div className="alert alert-error">{error}</div>}

        {view === 'list' && (
          <>
            <p className="form-hint" style={{ marginTop: 0 }}>
              A group is a set of packages shared by several operators. Give operators a group from
              Operators → Manage Packages; changing the group here then changes all of them at once.
            </p>
            {canManage && (
              <div className="tab-toolbar">
                <button type="button" className="btn btn-primary" onClick={() => openForm()}>
                  <Plus size={18} /> Create Group
                </button>
              </div>
            )}
            {loading ? (
              <div className="loading-screen" style={{ height: 120 }}>
                <div className="spinner spinner-lg" />
              </div>
            ) : groups.length === 0 ? (
              <p className="form-hint">No package groups yet.</p>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Packages</th>
                      <th>Operators</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td>
                          <strong>{group.name}</strong>
                          {group.description && (
                            <span className="form-hint" style={{ display: 'block', margin: 0 }}>{group.description}</span>
                          )}
                        </td>
                        <td>
                          {group.packages.length
                            ? group.packages.map((pkg) => (
                                <span
                                  key={pkg.id}
                                  className={`badge ${pkg.isActive ? 'badge-info' : 'badge-danger'}`}
                                  style={{ marginRight: 6, marginBottom: 4 }}
                                  title={pkg.isActive ? undefined : 'Inactive package'}
                                >
                                  {pkg.name}
                                </span>
                              ))
                            : '—'}
                        </td>
                        <td title={group.operators.map((op) => op.clientName).join(', ')}>
                          {group.operators.length
                            ? `${group.operators.length}: ${group.operators.slice(0, 3).map((op) => op.clientName).join(', ')}${group.operators.length > 3 ? '…' : ''}`
                            : 'None'}
                        </td>
                        {canManage && (
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openForm(group)}>
                                <Pencil size={14} /> Edit
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDeleteTarget(group)}
                                disabled={group.operators.length > 0}
                                title={group.operators.length ? 'Remove the group from its operators first' : undefined}
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {view === 'form' && (
          <form id="package-group-form" onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Group Name</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Resort partners"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <input
                  className="form-input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={500}
                />
              </div>
              <div className="form-group form-group-full">
                <label className="form-label">Packages in this group</label>
                {selectablePackages.length ? (
                  <PackageSelector
                    packages={selectablePackages}
                    selectedIds={form.packageIds}
                    onChange={(packageIds) => setForm({ ...form, packageIds })}
                  />
                ) : (
                  <p className="form-hint">No active packages yet. Create a package first.</p>
                )}
                <p className="form-hint">
                  A group can mix Mobile and TV packages; each operator only gets the ones that match its
                  customer types.
                  {target?.operators.length
                    ? ` Saving changes the packages of ${target.operators.length} operator(s): ${target.operators.map((op) => op.clientName).join(', ')}.`
                    : ''}
                </p>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete package group?"
        message={`Delete "${deleteTarget?.name}"? No operator uses it, so nobody loses packages.`}
        confirmLabel="Delete"
        variant="danger"
        loading={submitting}
      />
    </>
  );
}
