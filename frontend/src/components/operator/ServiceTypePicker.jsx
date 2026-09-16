export default function ServiceTypePicker({ options, value, onChange, disabled = false }) {
  if (options.length <= 1) {
    return options.length === 1 ? (
      <p className="form-hint" style={{ margin: 0 }}>
        Customer type: <strong>{options[0].label}</strong>
      </p>
    ) : null;
  }

  return (
    <div className="service-type-picker" role="radiogroup" aria-label="Customer type">
      {options.map((tag) => (
        <button
          key={tag.key}
          type="button"
          role="radio"
          aria-checked={value === tag.key}
          className={`service-type-option${value === tag.key ? ' active' : ''}`}
          onClick={() => onChange(tag.key)}
          disabled={disabled}
        >
          {tag.label}
        </button>
      ))}
    </div>
  );
}
