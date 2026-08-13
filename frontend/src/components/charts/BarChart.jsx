import { formatShortDate } from '../../utils/dates';

export default function BarChart({
  data = [],
  valueKey = 'count',
  labelKey = 'date',
  formatLabel = formatShortDate,
  color = 'var(--color-primary)',
  height = 180,
  showLabelEvery = 5,
}) {
  const max = Math.max(...data.map((item) => item[valueKey] || 0), 1);

  if (data.length === 0) {
    return <div className="chart-empty">No activity in this period</div>;
  }

  return (
    <div className="bar-chart" style={{ height }}>
      <div className="bar-chart-bars">
        {data.map((item, index) => {
          const value = item[valueKey] || 0;
          const barHeight = Math.max((value / max) * 100, value > 0 ? 4 : 0);
          const showLabel = showLabelEvery <= 1 || index % showLabelEvery === 0 || index === data.length - 1;
          const label = formatLabel ? formatLabel(item[labelKey]) : item[labelKey];

          return (
            <div key={item[labelKey]} className="bar-chart-col" title={`${label}: ${value}`}>
              <div className="bar-chart-bar-wrap">
                <div
                  className="bar-chart-bar"
                  style={{ height: `${barHeight}%`, background: color }}
                />
              </div>
              <span className="bar-chart-label">{showLabel ? label : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
