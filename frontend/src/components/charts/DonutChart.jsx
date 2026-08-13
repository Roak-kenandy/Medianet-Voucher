const STATUS_COLORS = {
  created: '#059669',
  pending: '#d97706',
  processing: '#3b82f6',
  failed: '#dc2626',
};

const LABEL_COLORS = {
  Used: '#001b3d',
  Remaining: '#93c5fd',
  Active: '#059669',
  Inactive: '#9ca3af',
};

function getColor(item, index) {
  if (item.status) return STATUS_COLORS[item.status] || '#6b7280';
  if (item.label) return LABEL_COLORS[item.label] || '#6b7280';
  return ['#001b3d', '#3b82f6', '#059669', '#d97706', '#dc2626'][index % 5];
}

function getLabel(item) {
  if (item.status) return item.status;
  if (item.label) return item.label;
  return item.name || '';
}

export default function DonutChart({ data = [], size = 160, centerLabel, centerValue }) {
  const total = data.reduce((sum, item) => sum + (item.count || 0), 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (total === 0) {
    return (
      <div className="chart-empty">
        <div className="donut-chart" style={{ width: size, height: size }}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="12" />
          </svg>
          <div className="donut-center">
            <span className="donut-center-value">0</span>
            <span className="donut-center-label">No data</span>
          </div>
        </div>
      </div>
    );
  }

  const segments = data
    .filter((item) => item.count > 0)
    .map((item, index) => {
      const fraction = item.count / total;
      const dash = fraction * circumference;
      const segment = {
        ...item,
        color: getColor(item, index),
        label: getLabel(item),
        dash,
        offset,
      };
      offset += dash;
      return segment;
    });

  return (
    <div className="donut-chart-wrap">
      <div className="donut-chart" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="12" />
          {segments.map((segment) => (
            <circle
              key={segment.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="12"
              strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 50 50)"
            />
          ))}
        </svg>
        <div className="donut-center">
          <span className="donut-center-value">{centerValue ?? total.toLocaleString()}</span>
          {centerLabel && <span className="donut-center-label">{centerLabel}</span>}
        </div>
      </div>
      <ul className="chart-legend">
        {data.map((item, index) => (
          <li key={getLabel(item)} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: getColor(item, index) }} />
            <span className="chart-legend-label">{getLabel(item)}</span>
            <span className="chart-legend-value">{item.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { STATUS_COLORS };
