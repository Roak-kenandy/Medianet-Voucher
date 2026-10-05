import { formatMoney } from '../../utils/money';
import { formatDate } from '../../constants/appSettings';
import { getServiceTagShortLabel } from '../../constants/serviceTags';

const DAY_MS = 24 * 60 * 60 * 1000;

const SERVICE_STATE_LABELS = {
  EFFECTIVE: 'Active',
  NOT_EFFECTIVE: 'Not active',
  PAUSED: 'Paused',
  DRAFT: 'Draft',
  PENDING_VERIFICATION: 'Pending',
  CANCELLED: 'Cancelled',
  REGRETTED: 'Cancelled',
  SWAPPED: 'Swapped',
  REMOVED: 'Removed',
};

const PERIOD_UNITS = { DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year', HOUR: 'hour' };

function periodLabel(period) {
  if (!period?.duration || !PERIOD_UNITS[period.unit]) return null;
  const unit = PERIOD_UNITS[period.unit];
  return period.duration === 1 ? `per ${unit}` : `every ${period.duration} ${unit}s`;
}

/** Whole days from now until the date (negative once it has passed). */
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const time = new Date(isoDate).getTime();
  return Number.isNaN(time) ? null : Math.ceil((time - Date.now()) / DAY_MS);
}

function dueBadge(service) {
  const days = daysUntil(service.dueDate);
  if (days == null) return null;
  if (days < 0) return { tone: 'danger', text: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago` };
  if (days === 0) return { tone: 'warning', text: 'Due today' };
  if (days <= 7) return { tone: 'warning', text: `Due in ${days} day${days === 1 ? '' : 's'}` };
  return { tone: 'neutral', text: `${days} days left` };
}

/** Customer's account position in CRM: in credit, owing, or settled. */
export function AccountBalance({ account }) {
  if (!account) {
    return (
      <div className="customer-card-stat">
        <span className="customer-card-stat-label">Account balance</span>
        <span className="customer-card-stat-value muted">Not available</span>
      </div>
    );
  }
  const { creditAmount, dueAmount, currencyCode } = account;
  const tone = dueAmount > 0 ? 'danger' : creditAmount > 0 ? 'success' : '';
  return (
    <div className="customer-card-stat">
      <span className="customer-card-stat-label">Account balance</span>
      <span className={`customer-card-stat-value ${tone}`}>
        {formatMoney(dueAmount > 0 ? dueAmount : creditAmount, currencyCode)}
      </span>
      <span className="customer-card-stat-meta">
        {dueAmount > 0 ? 'Amount due' : creditAmount > 0 ? 'Available credit' : 'Nothing due, no credit'}
        {account.state && account.state !== 'ACTIVE' ? ` · Account ${account.state.toLowerCase()}` : ''}
      </span>
    </div>
  );
}

/** The customer's current services with price, renewal and due date. */
export function ServiceList({ services }) {
  if (services == null) {
    return <p className="customer-card-empty">Services could not be loaded from CRM.</p>;
  }
  if (!services.length) {
    return <p className="customer-card-empty">No active services on this customer.</p>;
  }
  return (
    <ul className="customer-service-list">
      {services.map((service) => {
        const due = dueBadge(service);
        const period = periodLabel(service.billingPeriod);
        const isActive = service.state === 'EFFECTIVE';
        return (
          <li key={service.id} className="customer-service-item">
            <div className="customer-service-main">
              <span className="customer-service-name">{service.name}</span>
              <span className="customer-service-meta">
                {service.price != null && formatMoney(service.price, service.currencyCode || 'MVR')}
                {service.price != null && period ? ` ${period}` : period || ''}
                {service.autoRenew === true && ' · Auto-renews'}
                {service.autoRenew === false && ' · Does not renew'}
                {service.inTrial && ' · In trial'}
              </span>
            </div>
            <div className="customer-service-side">
              <span className={`badge ${isActive ? 'badge-success' : 'badge-neutral'}`}>
                {SERVICE_STATE_LABELS[service.state] || service.state || 'Unknown'}
              </span>
              {service.dueDate && (
                <span className="customer-service-due">
                  <span className="customer-service-due-label">Due date</span>
                  <strong>{formatDate(service.dueDate)}</strong>
                  {due && <span className={`customer-service-due-badge ${due.tone}`}>{due.text}</span>}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Customer header (who they are) plus whatever the current tab puts underneath. */
export default function CustomerCard({ customer, children }) {
  return (
    <article className="customer-card">
      <header className="customer-card-header">
        <div>
          <h4 className="customer-card-name">{customer.name}</h4>
          <p className="customer-card-contact">
            {customer.phone || 'No phone on record'}
            {customer.code ? ` · Customer ${customer.code}` : ''}
          </p>
        </div>
        <div className="customer-card-tags">
          <span className="badge badge-info">
            {customer.serviceTypeShort || getServiceTagShortLabel(customer.serviceTag)}
          </span>
          {customer.deviceCode && (
            <span className="customer-card-code" title="Service code">
              {customer.deviceCode}
            </span>
          )}
        </div>
      </header>
      <div className="customer-card-body">{children}</div>
    </article>
  );
}
