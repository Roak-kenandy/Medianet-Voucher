import TableToolbar from '../TableToolbar';
import TablePagination from '../TablePagination';
import { formatMoney } from '../../utils/money';
import '../../pages/admin/admin-shared.css';

const TOPUP_SUMMARY_KEYS = [
  'totalRecords',
  'uniqueOperators',
  'totalAmountPaid',
  'totalGstAmount',
  'totalCommission',
  'totalCredited',
];

const SUMMARY_LABELS = {
  totalRecords: 'Transactions',
  uniqueOperators: 'Operators',
  totalAmountPaid: 'Total Paid',
  totalGstAmount: 'Total GST',
  totalCommission: 'Total Commission',
  totalCredited: 'Total Credited',
};

export default function TopupReportResults({
  report,
  search,
  onSearchChange,
  page,
  onPageChange,
  pagination,
  loading = false,
}) {
  const currencyCode = report?.summary?.currencyCode || 'MVR';
  const pagedRows = report?.rows || [];
  const pageInfo = pagination || {
    page: page || 1,
    limit: pagedRows.length || 50,
    total: report?.pagination?.total ?? pagedRows.length,
    totalPages: report?.pagination?.totalPages ?? 1,
  };

  if (!report) return null;

  return (
    <>
      {report.summary && (
        <div className="topup-report-summary">
          {TOPUP_SUMMARY_KEYS.map((key) => (
            <div className="topup-report-summary-card" key={key}>
              <span className="topup-report-summary-label">{SUMMARY_LABELS[key]}</span>
              <span className="topup-report-summary-value">
                {key === 'totalRecords' || key === 'uniqueOperators'
                  ? Number(report.summary[key] ?? 0).toLocaleString()
                  : formatMoney(report.summary[key], currencyCode)}
              </span>
            </div>
          ))}
          <div className="topup-report-summary-card topup-report-summary-meta">
            <span className="topup-report-summary-label">GST Rate</span>
            <span className="topup-report-summary-value">{report.summary.gstRatePercent}%</span>
          </div>
        </div>
      )}

      <div className="card topup-report-card">
        <div className="card-header topup-report-card-header">
          <div>
            <h3 className="card-title">Operator Top-up Report</h3>
            <p className="card-subtitle">
              Generated {new Date(report.generatedAt).toLocaleString()}
              {report.filters.startDate && report.filters.endDate && (
                <> · {report.filters.startDate} to {report.filters.endDate}</>
              )}
              {pageInfo.total != null && (
                <> · {pageInfo.total.toLocaleString()} transactions total</>
              )}
            </p>
          </div>
        </div>

        {(pageInfo.total > 0 || pagedRows.length > 0) && (
          <TableToolbar
            value={search}
            onChange={onSearchChange}
            placeholder="Search by operator, reference, source, or email..."
          />
        )}

        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-screen" style={{ height: 120 }}>
              <div className="spinner" />
            </div>
          ) : pageInfo.total === 0 ? (
            <div className="empty-state"><p>No top-ups found for the selected period</p></div>
          ) : pagedRows.length === 0 ? (
            <div className="empty-state"><p>No rows match your search</p></div>
          ) : (
            <>
              <div className="table-wrapper topup-report-table-wrap">
                <table className="table topup-report-table">
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Reference</th>
                      <th>Operator</th>
                      <th>Source</th>
                      <th className="col-money">Amount Paid</th>
                      <th className="col-money">GST</th>
                      <th className="col-money">After GST</th>
                      <th className="col-money">Commission</th>
                      <th className="col-money col-highlight">Credited</th>
                      <th>Processed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row) => (
                      <tr key={row.reference || row.transactionId}>
                        <td className="col-time">{row.time}</td>
                        <td className="col-reference">
                          <code>{row.reference}</code>
                        </td>
                        <td className="col-operator">
                          <span className="topup-operator-name">{row.operator}</span>
                          {row.operatorEmail && (
                            <span className="topup-operator-email">{row.operatorEmail}</span>
                          )}
                        </td>
                        <td>{row.source || '—'}</td>
                        <td className="col-money">{formatMoney(row.amountPaid, currencyCode)}</td>
                        <td className="col-money col-deduct">−{formatMoney(row.gstAmount, currencyCode)}</td>
                        <td className="col-money">{formatMoney(row.afterGst, currencyCode)}</td>
                        <td className="col-money col-bonus">
                          {row.commission > 0 ? `+${formatMoney(row.commission, currencyCode)}` : '—'}
                        </td>
                        <td className="col-money col-highlight">
                          {formatMoney(row.credited, currencyCode)}
                        </td>
                        <td className="col-user">{row.processedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                page={pageInfo.page}
                totalPages={pageInfo.totalPages}
                total={pageInfo.total}
                limit={pageInfo.limit}
                onPageChange={onPageChange}
                itemLabel="transactions"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
