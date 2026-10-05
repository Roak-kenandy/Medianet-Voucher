import { packageMatchesScope, packageMatchesSalesModels } from '../../constants/serviceTags';

/**
 * Checkbox list of package groups. Each row shows the packages the group would give an
 * operator with the given customer types (`serviceScope`) and sales models.
 */
export default function PackageGroupPicker({
  groups,
  selectedIds,
  onChange,
  serviceScope = 'BOTH',
  salesModelIds,
  disabled = false,
}) {
  const selected = selectedIds.map(Number);

  const toggle = (groupId) => {
    if (disabled) return;
    const id = Number(groupId);
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  if (!groups.length) {
    return <p className="form-hint">No package groups yet. Create one from Packages → Package Groups.</p>;
  }

  return (
    <div className="operator-permissions-grid" role="group" aria-label="Package groups">
      {groups.map((group) => {
        const usable = group.packages.filter(
          (pkg) =>
            pkg.isActive && packageMatchesScope(pkg, serviceScope) && packageMatchesSalesModels(pkg, salesModelIds)
        );
        return (
          <label key={group.id} className="checkbox-label" style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={selected.includes(Number(group.id))}
              onChange={() => toggle(group.id)}
              disabled={disabled}
            />
            <span>
              <strong>{group.name}</strong>
              <span className="form-hint" style={{ display: 'block', margin: 0 }}>
                {usable.length
                  ? usable.map((pkg) => pkg.name).join(', ')
                  : 'No packages for these customer types and sales models'}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
