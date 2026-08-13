export default function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <div className={`card chart-card ${className}`.trim()}>
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
      </div>
      <div className="card-body chart-card-body">{children}</div>
    </div>
  );
}
