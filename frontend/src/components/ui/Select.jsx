import { Children, Fragment, isValidElement, useMemo } from 'react';
import ReactSelect from 'react-select';
import './ui-controls.css';

const SEARCHABLE_FROM = 7;

/** Flattens native <option> children (including arrays and fragments) into react-select options. */
function collectOptions(children, options = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      collectOptions(child.props.children, options);
      return;
    }
    if (child.type === 'option') {
      const { value, children: label, disabled } = child.props;
      const text = Children.toArray(label).join('');
      options.push({
        value: String(value ?? text),
        label: text,
        isDisabled: Boolean(disabled),
      });
    }
  });
  return options;
}

/**
 * Drop-in replacement for a native <select className="form-input">: same <option> children,
 * and onChange still receives an event-like object, so callers keep using e.target.value.
 */
export default function Select({
  id,
  name,
  value,
  onChange,
  children,
  disabled = false,
  required = false,
  placeholder = 'Select…',
  searchable,
  style,
  className = '',
  'aria-label': ariaLabel,
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  const selected = options.find((option) => option.value === String(value ?? '')) || null;
  const isSearchable = searchable ?? options.length >= SEARCHABLE_FROM;
  // Callers migrated from native selects still pass "form-input"; the control has its own border.
  const extraClasses = className
    .split(/\s+/)
    .filter((name) => name && name !== 'form-input')
    .join(' ');

  const handleChange = (option) => {
    const nextValue = option ? option.value : '';
    onChange?.({ target: { value: nextValue, name, id }, currentTarget: { value: nextValue, name, id } });
  };

  return (
    <ReactSelect
      inputId={id}
      name={name}
      className={`ui-select ${extraClasses}`.trim()}
      classNamePrefix="ui-select"
      options={options}
      value={selected}
      onChange={handleChange}
      isDisabled={disabled}
      isSearchable={isSearchable}
      required={required}
      placeholder={placeholder}
      aria-label={ariaLabel}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPlacement="auto"
      styles={{
        container: (base) => ({ ...base, ...style }),
        menuPortal: (base) => ({ ...base, zIndex: 3000 }),
      }}
      noOptionsMessage={() => 'No matches'}
      unstyled
    />
  );
}
