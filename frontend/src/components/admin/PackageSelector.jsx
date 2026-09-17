import { formatMoney } from '../../utils/money';
import './PackageSelector.css';

export default function PackageSelector({
  packages,
  selectedIds,
  onChange,
  disabled = false,
  currencyCode = 'MVR',
}) {
  if (!packages.length) return null;

  const packageIds = packages.map((pkg) => Number(pkg.id));
  const selected = selectedIds.map(Number);
  const allSelected =
    packageIds.length > 0 && packageIds.every((id) => selected.includes(id));
  const noneSelected = selected.length === 0;

  const toggleAll = () => {
    if (disabled) return;
    onChange(allSelected ? [] : packageIds);
  };

  const toggleOne = (packageId) => {
    if (disabled) return;
    const id = Number(packageId);
    onChange(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id]
    );
  };

  return (
    <div className={`package-selector${disabled ? ' is-disabled' : ''}`}>
      <div className="package-selector-toolbar">
        <label className="package-selector-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && !noneSelected;
            }}
            onChange={toggleAll}
            disabled={disabled}
          />
          <span>Select all</span>
        </label>
        <span className="package-selector-count">
          {selected.length} of {packages.length} selected
        </span>
      </div>

      <div className="package-selector-list" role="group" aria-label="Packages">
        {packages.map((pkg) => {
          const isSelected = selected.includes(Number(pkg.id));
          const price = pkg.price_amount ?? pkg.priceAmount;
          const currency = pkg.currency_code ?? pkg.currencyCode ?? currencyCode;
          return (
            <label
              key={pkg.id}
              className={`package-selector-item${isSelected ? ' is-selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleOne(pkg.id)}
                disabled={disabled}
              />
              <span className="package-selector-item-body">
                <span className="package-selector-item-name">{pkg.label || pkg.name}</span>
                {price != null && (
                  <span className="package-selector-item-price">
                    {formatMoney(price, currency)}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
