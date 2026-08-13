export default function HorizontalBarChart({ data = [], labelKey = 'clientName', valueKey = 'accountsCreated', maxKey = 'accountQuota' }) {
  const max = Math.max(...data.map((item) => item[maxKey] || item[valueKey] || 0), 1);

  if (data.length === 0) {
    return <div className="chart-empty">No operators yet</div>;
  }

  return (
    <div className="hbar-chart">
      {data.map((item) => {
        const value = item[valueKey] || 0;
        const quota = item[maxKey];
        const width = Math.max((value / max) * 100, value > 0 ? 2 : 0);
        const showQuota = quota != null && quota > 0;

        return (
          <div key={item[labelKey]} className="hbar-row">
            <div className="hbar-label" title={item[labelKey]}>{item[labelKey]}</div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="hbar-value">
              {value.toLocaleString()}
              {showQuota && (
                <span className="hbar-meta"> / {quota.toLocaleString()}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
