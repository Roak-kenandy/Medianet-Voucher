import TableToolbar, { useClientTable } from '../TableToolbar';
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

export default function TopupReportResults({ report, search, onSearchChange, page, onPageChange }) {
  const currencyCode = report?.summary?.currencyCode || 'MVR';
  const columns = [
    'time',
    'reference',
    'operator',
    'amountPaid',
    'gstAmount',
    'afterGst',
    'commission',
    'credited',
    'processedBy',
  ];

  const { rows: pagedRows, pagination } = useClientTable(report?.rows || [], {
    search,
    page,
    limit: 15,
    columns,
  });

  if (!report) return null;

  return (
    <>
      <div className="topup-report-summary">
        {TOPUP_SUMMARY_KEYS.map((key) => (
          <div className="topup-report-summary-card" key={key}>
            <span className="topup-report-summary-label">{SUMMARY_LABELS[key]}</span>
            <span className="topup-report-summary-value">
              {key === 'totalRecords' || key === 'uniqueOperators'
                ? report.summary[key]
                : formatMoney(report.summary[key], currencyCode)}
            </span>
          </div>
        ))}
        <div className="topup-report-summary-card topup-report-summary-meta">
          <span className="topup-report-summary-label">GST Rate</span>
          <span className="topup-report-summary-value">{report.summary.gstRatePercent}%</span>
        </div>
      </div>

      <div className="card topup-report-card">
        <div className="card-header topup-report-card-header">
          <div>
            <h3 className="card-title">Operator Top-up Report</h3>
            <p className="card-subtitle">
              Generated {new Date(report.generatedAt).toLocaleString()}
              {report.filters.startDate && report.filters.endDate && (
                <> · {report.filters.startDate} to {report.filters.endDate}</>
              )}
            </p>
          </div>
        </div>

        {report.rows.length > 0 && (
          <TableToolbar
            value={search}
            onChange={onSearchChange}
            placeholder="Search by operator, reference, or email..."
          />
        )}

        <div className="card-body" style={{ padding: 0 }}>
          {report.rows.length === 0 ? (
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
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                limit={pagination.limit}
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
