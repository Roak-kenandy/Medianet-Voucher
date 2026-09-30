import { useState } from 'react';
import TableToolbar from '../TableToolbar';
import TablePagination from '../TablePagination';
import { formatMoney } from '../../utils/money';
import { adminApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
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
  canVoid = false,
  onVoided,
}) {
  const currencyCode = report?.summary?.currencyCode || 'MVR';
  const pagedRows = report?.rows || [];
  const pageInfo = pagination || {
    page: page || 1,
    limit: pagedRows.length || 50,
    total: report?.pagination?.total ?? pagedRows.length,
    totalPages: report?.pagination?.totalPages ?? 1,
  };

  const toast = useToast();
  const [voidTarget, setVoidTarget] = useState(null);
  const [adjustAction, setAdjustAction] = useState('deduct');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [voidNote, setVoidNote] = useState('');
  const [voiding, setVoiding] = useState(false);

  const openAdjust = (row) => {
    setVoidTarget(row);
    setAdjustAction('deduct');
    setAdjustAmount('');
    setVoidNote('');
  };

  const submitVoid = async () => {
    if (!voidTarget) return;
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (voidNote.trim().length < 3) {
      toast.error('Enter a note of at least 3 characters');
      return;
    }
    setVoiding(true);
    try {
      const result = await adminApi.adjustOperatorTopup(voidTarget.transactionId, {
        action: adjustAction,
        amount,
        note: voidNote.trim(),
      });
      const verb = result.action === 'add' ? 'Added' : 'Removed';
      toast.success(`${verb} ${formatMoney(result.amount, currencyCode)}`);
      setVoidTarget(null);
      setAdjustAmount('');
      setVoidNote('');
      onVoided?.();
    } catch (err) {
      toast.error(err.message || 'Could not adjust this top-up');
    } finally {
      setVoiding(false);
    }
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
                      <th>Time</th>
                      <th>Action</th>
                      <th>Type</th>
                      <th>ID/Receipt no</th>
                      <th>Dealer/Operator</th>
                      <th>Commission ratio</th>
                      <th className="col-money">Original Amount</th>
                      <th className="col-money">Total TopUp</th>
                      <th className="col-money">GST</th>
                      <th className="col-money">BP Commission</th>
                      <th>User</th>
                      <th>Note</th>
                      {canVoid && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row) => (
                      <tr key={`${row.action}-${row.transactionId}`}>
                        <td className="col-time">{row.time}</td>
                        <td>{row.action}</td>
                        <td>{row.paymentType || '—'}</td>
                        <td className="col-reference">
                          <code title={row.receiptNo || undefined}>{row.receiptNo || '—'}</code>
                        </td>
                        <td className="col-operator">
                          <span className="topup-operator-name" title={row.operator}>{row.operator}</span>
                          {row.operatorEmail && (
                            <span className="topup-operator-email" title={row.operatorEmail}>{row.operatorEmail}</span>
                          )}
                        </td>
                        <td>{row.commissionRatio || '—'}</td>
                        <td className="col-money">{formatMoney(row.originalAmount, currencyCode)}</td>
                        <td className="col-money col-highlight">{formatMoney(row.totalTopupAmount, currencyCode)}</td>
                        <td className="col-money">{formatMoney(row.gstAmount, currencyCode)}</td>
                        <td className="col-money">{row.commission ? formatMoney(row.commission, currencyCode) : '—'}</td>
                        <td className="col-user">
                          <span className="cell-clip" title={row.processedBy || undefined}>{row.processedBy}</span>
                        </td>
                        <td>
                          <span className="cell-clip" title={row.note || undefined}>{row.note || '—'}</span>
                        </td>
                        {canVoid && (
                          <td>
                            {row.canVoid ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openAdjust(row)}
                              >
                                Adjust
                              </button>
                            ) : null}
                          </td>
                        )}
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

      {voidTarget && (
        <div className="modal-overlay" onClick={() => !voiding && setVoidTarget(null)}>
          <div className="modal adjust-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="void-topup-title">
            <div className="modal-header">
              <h3 className="modal-title" id="void-topup-title">Adjust wallet credit</h3>
              <button type="button" className="modal-close" onClick={() => setVoidTarget(null)} disabled={voiding} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="card-subtitle adjust-dialog-note">
                {voidTarget.operator} was credited {formatMoney(voidTarget.credited, currencyCode)}.
                The original row stays. The amount you enter is recorded as its own row.
              </p>
              <div className="form-group">
                <label className="form-label">Action</label>
                <div className="adjust-action-toggle">
                  <button
                    type="button"
                    className={`btn btn-sm ${adjustAction === 'add' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAdjustAction('add')}
                    disabled={voiding}
                  >
                    Add credit
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${adjustAction === 'deduct' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAdjustAction('deduct')}
                    disabled={voiding}
                  >
                    Remove credit
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="adjustAmount">Amount (MVR)</label>
                <input
                  id="adjustAmount"
                  type="number"
                  className="form-input"
                  min="0.01"
                  step="0.01"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="Amount to add or remove"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="voidNote">Note</label>
                <textarea
                  id="voidNote"
                  className="form-input"
                  rows={3}
                  value={voidNote}
                  onChange={(e) => setVoidNote(e.target.value)}
                  placeholder="Why this amount is being changed"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setVoidTarget(null)} disabled={voiding}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={submitVoid} disabled={voiding}>
                {voiding ? 'Saving…' : 'Save adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
