import { Check, RefreshCw, ArrowUpCircle, PlusCircle } from 'lucide-react';
import { formatMoney } from '../../utils/money';

/** Add-ons the customer cannot have yet become selectable once a base they need is ticked. */
export function isOptionSelectable(option, selectedIds = []) {
  if (option.eligible) return true;
  return (option.requiresOneOf || []).some((id) => selectedIds.includes(id));
}

function OptionRow({ option, pkg, currencyCode, selected, disabled, onSelect, note, warning, multi, charge }) {
  const currency = pkg.currencyCode || currencyCode;
  return (
    <button
      type="button"
      className={`package-option${selected ? ' selected' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className={`package-option-check${multi ? '' : ' round'}`} aria-hidden="true">
        {selected ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="package-option-main">
        <span className="package-option-name">
          {pkg.name}
          {option.role === 'addon' && <span className="badge badge-warning">Add-on</span>}
        </span>
        {note && <span className="package-option-note">{note}</span>}
        {warning && <span className="package-option-warning">{warning}</span>}
      </span>
      {charge ? (
        <span className="package-option-price">
          {formatMoney(charge.amount, currency)}
          <span className="package-option-price-detail">
            {formatMoney(charge.newCharge, currency)} for the rest of the term
            {charge.credit > 0 ? `, less ${formatMoney(charge.credit, currency)} credit` : ''}
          </span>
        </span>
      ) : (
        <span className="package-option-price">{formatMoney(pkg.priceAmount, currency)}</span>
      )}
    </button>
  );
}

/**
 * What this customer can be sold, worked out by the server from the services they already have:
 * continue a package they have, upgrade their base package, or add something new.
 * `selection` is { action, packageIds } or null.
 */
export default function PackageOptions({ options, packages, currencyCode, selection, onSelect, disabled }) {
  if (options == null) {
    return (
      <p className="customer-card-empty">
        Packages cannot be offered because the customer's current services could not be loaded. Search again.
      </p>
    );
  }

  const packageById = new Map(packages.map((pkg) => [Number(pkg.id), pkg]));
  const known = options.filter((option) => packageById.has(option.packageId));
  if (!known.length) {
    return <p className="customer-card-empty">No packages are assigned to you for this customer type.</p>;
  }

  const selectedIds = selection?.packageIds || [];
  const addIds = selection?.action === 'subscribe' ? selectedIds : [];
  const renewals = known.filter((option) => option.action === 'renew');
  const upgrades = known.filter((option) => option.action === 'upgrade');
  const additions = known.filter(
    (option) => option.action === 'subscribe' || (!option.eligible && option.requiresOneOf?.length)
  );
  const unavailable = known.filter((option) => !option.eligible && !option.requiresOneOf?.length);

  const isSelected = (action, id) => selection?.action === action && selectedIds.includes(id);
  const pickOne = (action, id) => onSelect(isSelected(action, id) ? null : { action, packageIds: [id] });
  // Several packages can be renewed in one go.
  const toggleRenewal = (id) => {
    const current = selection?.action === 'renew' ? selectedIds : [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    onSelect(next.length ? { action: 'renew', packageIds: next } : null);
  };
  const allRenewalIds = renewals.map((option) => option.packageId);
  const allRenewalsSelected =
    selection?.action === 'renew' && allRenewalIds.every((id) => selectedIds.includes(id));

  const toggleAddition = (id) => {
    let next = addIds.includes(id) ? addIds.filter((item) => item !== id) : [...addIds, id];
    // Unticking a base also drops add-ons that were only allowed because of it.
    next = next.filter((item) => {
      const option = additions.find((entry) => entry.packageId === item);
      return option && isOptionSelectable(option, next);
    });
    onSelect(next.length ? { action: 'subscribe', packageIds: next } : null);
  };

  return (
    <div className="package-options">
      {renewals.length > 0 && (
        <section>
          <h6 className="package-options-title">
            <RefreshCw size={14} /> Continue current {renewals.length > 1 ? 'packages' : 'package'}
            {renewals.length > 1 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm package-options-all"
                disabled={disabled}
                onClick={() => onSelect(allRenewalsSelected ? null : { action: 'renew', packageIds: allRenewalIds })}
              >
                {allRenewalsSelected ? 'Clear' : 'Select all'}
              </button>
            )}
          </h6>
          {renewals.map((option) => (
            <OptionRow
              key={option.packageId}
              option={option}
              pkg={packageById.get(option.packageId)}
              currencyCode={currencyCode}
              selected={isSelected('renew', option.packageId)}
              disabled={disabled}
              onSelect={() => toggleRenewal(option.packageId)}
              multi
              note="Renews the service the customer already has"
            />
          ))}
        </section>
      )}

      {upgrades.length > 0 && (
        <section>
          <h6 className="package-options-title"><ArrowUpCircle size={14} /> Upgrade</h6>
          {upgrades.map((option) => (
            <OptionRow
              key={option.packageId}
              option={option}
              pkg={packageById.get(option.packageId)}
              currencyCode={currencyCode}
              selected={isSelected('upgrade', option.packageId)}
              disabled={disabled}
              onSelect={() => pickOne('upgrade', option.packageId)}
              charge={option.charge}
              note={
                option.upgradeMode === 'replace'
                  ? `Full price. ${option.replaces?.name || 'The current package'} is cancelled and this starts as a new subscription, because CRM cannot switch it in place.`
                  : option.replaces
                    ? `Replaces ${option.replaces.name}, keeps the current due date`
                    : null
              }
              warning={
                option.cancels?.length
                  ? `${option.cancels.map((item) => item.name).join(', ')} will be cancelled: not available with this package`
                  : null
              }
            />
          ))}
        </section>
      )}

      {additions.length > 0 && (
        <section>
          <h6 className="package-options-title"><PlusCircle size={14} /> Add a package</h6>
          {additions.map((option) => {
            const selectable = isOptionSelectable(option, addIds);
            return (
              <OptionRow
                key={option.packageId}
                option={option}
                pkg={packageById.get(option.packageId)}
                currencyCode={currencyCode}
                selected={isSelected('subscribe', option.packageId)}
                disabled={disabled || !selectable}
                onSelect={() => toggleAddition(option.packageId)}
                note={selectable ? null : option.reason}
                multi
              />
            );
          })}
        </section>
      )}

      {unavailable.length > 0 && (
        <section>
          <h6 className="package-options-title muted">Not available for this customer</h6>
          <ul className="package-options-unavailable">
            {unavailable.map((option) => (
              <li key={option.packageId}>
                <span>{packageById.get(option.packageId).name}</span>
                <span>{option.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
