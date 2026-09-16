import { Check } from 'lucide-react';
import { formatMoney } from '../../utils/money';
import { togglePackageId } from '../../utils/packageSelection';

export default function PackagePicker({
  packages,
  selectedIds,
  onChange,
  currencyCode = 'MVR',
  disabled = false,
  multiSelect = true,
}) {
  if (!packages.length) return null;

  if (packages.length === 1) {
    const pkg = packages[0];
    return (
      <div className="package-picker-single">
        <span className="package-picker-single-name">{pkg.name}</span>
        <span className="package-picker-single-price">
          {formatMoney(pkg.priceAmount, pkg.currencyCode || currencyCode)}
        </span>
      </div>
    );
  }

  const handleSelect = (packageId) => {
    if (disabled) return;
    if (multiSelect) {
      onChange(togglePackageId(selectedIds, packageId));
    } else {
      onChange([Number(packageId)]);
    }
  };

  return (
    <div className="package-picker-grid">
      {packages.map((pkg) => {
        const isSelected = selectedIds.map(Number).includes(Number(pkg.id));
        return (
          <button
            key={pkg.id}
            type="button"
            className={`package-picker-card${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
            onClick={() => handleSelect(pkg.id)}
            disabled={disabled}
            aria-pressed={isSelected}
          >
            <span className="package-picker-card-check" aria-hidden="true">
              {isSelected ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <div className="package-picker-card-name">{pkg.name}</div>
            <div className="package-picker-card-price">
              {formatMoney(pkg.priceAmount, pkg.currencyCode || currencyCode)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
